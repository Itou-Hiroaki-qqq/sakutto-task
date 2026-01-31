import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getTasksForDate, getTasksBasicForDate, updateTasksWithCompletionStatus, getOverdueTaskDates, clearTasksCache } from '@/lib/tasks';
import { sql } from '@/lib/db';
import { isSameDay, startOfDay, format } from 'date-fns';

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const dateStr = searchParams.get('date');
        const basic = searchParams.get('basic') === 'true';

        if (!dateStr) {
            return NextResponse.json({ error: 'Date parameter is required' }, { status: 400 });
        }

        const date = new Date(dateStr);
        let tasks;

        if (basic) {
            // 段階的読み込み: 基本情報のみを返す
            tasks = await getTasksBasicForDate(user.id, date);
        } else {
            // 通常読み込み: 完了状態を含む完全なデータを返す
            tasks = await getTasksForDate(user.id, date);
        }

        // 現在日の場合、未完了の過去タスクがある日を取得（基本情報のみの場合は取得しない）
        const today = startOfDay(new Date());
        const targetDate = startOfDay(date);
        let overdueDates: Date[] = [];
        if (!basic && isSameDay(targetDate, today)) {
            overdueDates = await getOverdueTaskDates(user.id, today);
        }

        return NextResponse.json({ 
            tasks,
            overdueDates: overdueDates.map(d => format(d, 'yyyy-MM-dd'))
        });
    } catch (error) {
        console.error('Error fetching tasks:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

// 完了状態のみを更新（段階的読み込み用）
export async function PATCH(request: NextRequest) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { tasks, date } = body;

        if (!tasks || !Array.isArray(tasks) || !date) {
            return NextResponse.json(
                { error: 'Tasks array and date are required' },
                { status: 400 }
            );
        }

        const targetDate = new Date(date);
        const updatedTasks = await updateTasksWithCompletionStatus(tasks, user.id, targetDate);

        return NextResponse.json({ tasks: updatedTasks });
    } catch (error) {
        console.error('Error updating completion status:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const {
            title,
            dueDate,
            notificationEnabled,
            notificationTime,
            recurrenceType,
            customDays,
            customUnit,
            selectedWeekdays,
        } = body;

        if (!title || !dueDate) {
            return NextResponse.json(
                { error: 'Title and due date are required' },
                { status: 400 }
            );
        }

        // タスクを作成
        // notification_timeは文字列型（HH:mm形式）で保存
        const taskResult = await sql`
        INSERT INTO tasks (user_id, title, due_date, notification_enabled, notification_time)
        VALUES (${user.id}, ${title}, ${dueDate}, ${notificationEnabled}, ${notificationTime || null})
        RETURNING id, notification_time
    `;
        
        // デバッグ: 保存された通知時刻をログ出力
        if (notificationEnabled && notificationTime) {
            console.log(`[Task Creation] Task created with notification_time: "${notificationTime}" (saved as: "${taskResult[0].notification_time}")`);
        }

        const taskId = taskResult[0].id;

        // 繰り返し設定がある場合
        if (recurrenceType) {
            await sql`
        INSERT INTO task_recurrences (task_id, type, custom_days, custom_unit, weekdays)
        VALUES (
            ${taskId},
            ${recurrenceType},
            ${customDays},
            ${customUnit || null},
            ${selectedWeekdays ? sql`${selectedWeekdays}::integer[]` : null}
        )
        `;
        }

        // キャッシュをクリア
        clearTasksCache(user.id);

        return NextResponse.json({ success: true, taskId });
    } catch (error: any) {
        console.error('Error creating task:', error);
        return NextResponse.json(
            { error: error?.message || 'Internal server error', details: error },
            { status: 500 }
        );
    }
}

export async function PUT(request: NextRequest) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const {
            taskId,
            title,
            dueDate,
            notificationEnabled,
            notificationTime,
            recurrenceType,
            customDays,
            customUnit,
            selectedWeekdays,
            updateScope, // 'this_only' | 'all_future' - 繰り返し予定の編集時
            targetDate,  // 編集対象の発生日 (yyyy-MM-dd) - updateScope: 'this_only' のときに必要
        } = body;

        if (!taskId || !title || !dueDate) {
            return NextResponse.json(
                { error: 'Task ID, title and due date are required' },
                { status: 400 }
            );
        }

        // 繰り返し予定の「この予定のみ変更」の場合
        if (updateScope === 'this_only' && targetDate) {
            // 1. 元の繰り返しタスクに除外日を追加
            await sql`
                DELETE FROM task_exclusions 
                WHERE task_id = ${taskId} AND excluded_date = ${targetDate} AND exclusion_type = 'single'
            `;
            await sql`
                INSERT INTO task_exclusions (task_id, excluded_date, exclusion_type)
                VALUES (${taskId}, ${targetDate}, 'single')
                ON CONFLICT (task_id, excluded_date, exclusion_type) DO NOTHING
            `;

            // 2. 変更内容で新しい単発タスクを作成
            await sql`
                INSERT INTO tasks (user_id, title, due_date, notification_enabled, notification_time)
                VALUES (${user.id}, ${title}, ${dueDate}, ${notificationEnabled}, ${notificationTime || null})
            `;

            clearTasksCache(user.id);
            return NextResponse.json({ success: true });
        }

        // 「これ以降のすべての繰り返し予定も変更」または単発タスクの場合: 従来の更新処理
        const updateResult = await sql`
        UPDATE tasks
        SET title = ${title},
            due_date = ${dueDate},
            notification_enabled = ${notificationEnabled},
            notification_time = ${notificationTime || null}
        WHERE id = ${taskId} AND user_id = ${user.id}
        RETURNING notification_time
    `;
        
        if (notificationEnabled && notificationTime && updateResult.length > 0) {
            console.log(`[Task Update] Task updated with notification_time: "${notificationTime}" (saved as: "${updateResult[0].notification_time}")`);
        }

        if (recurrenceType) {
            await sql`
                DELETE FROM task_recurrences WHERE task_id = ${taskId}
            `;
            
            await sql`
                INSERT INTO task_recurrences (task_id, type, custom_days, custom_unit, weekdays)
                VALUES (
                    ${taskId},
                    ${recurrenceType},
                    ${customDays},
                    ${customUnit || null},
                    ${selectedWeekdays ? sql`${selectedWeekdays}::integer[]` : null}
                )
            `;
        } else {
            await sql`
                DELETE FROM task_recurrences WHERE task_id = ${taskId}
            `;
        }

        clearTasksCache(user.id, taskId);
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Error updating task:', error);
        return NextResponse.json(
            { error: error?.message || 'Internal server error', details: error },
            { status: 500 }
        );
    }
}
