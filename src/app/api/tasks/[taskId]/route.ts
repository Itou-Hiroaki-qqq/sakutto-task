import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sql } from '@/lib/db';
import { parseISO, isBefore } from 'date-fns';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ taskId: string }> }
) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { taskId } = await params;

        // タスクを取得
        const taskResult = await sql`
        SELECT * FROM tasks
        WHERE id = ${taskId} AND user_id = ${user.id}
        LIMIT 1
    `;

        if (taskResult.length === 0) {
            // デバッグ: ユーザーIDとタスクIDを確認
            const allTasks = await sql`
                SELECT id, user_id, title FROM tasks WHERE id = ${taskId} LIMIT 1
            `;
            console.error('Task not found:', {
                requestedTaskId: taskId,
                userId: user.id,
                foundTask: allTasks[0] || null,
            });
            return NextResponse.json(
                { error: 'Task not found', taskId, userId: user.id },
                { status: 404 }
            );
        }

        const task = taskResult[0];

        // 繰り返し設定を取得
        const recurrenceResult = await sql`
        SELECT * FROM task_recurrences
        WHERE task_id = ${taskId}
        LIMIT 1
    `;

        const taskData = {
            id: task.id,
            title: task.title,
            due_date: task.due_date,
            notification_enabled: task.notification_enabled,
            notification_time: task.notification_time,
        };

        const recurrenceData = recurrenceResult.length > 0
            ? {
                type: recurrenceResult[0].type,
                custom_days: recurrenceResult[0].custom_days,
                custom_unit: recurrenceResult[0].custom_unit,
                weekdays: recurrenceResult[0].weekdays,
            }
            : null;

        console.log('Task loaded:', { taskId, task: taskData, recurrence: recurrenceData });

        return NextResponse.json({
            task: taskData,
            recurrence: recurrenceData,
        });
    } catch (error) {
        console.error('Error fetching task:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ taskId: string }> }
) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { taskId } = await params;
        
        // リクエストボディから削除オプションを取得
        const body = await request.json().catch(() => ({}));
        const { deleteOption, targetDate } = body; // deleteOption: 'this_only' | 'future_all', targetDate: 'yyyy-MM-dd'

        // タスクを取得
        const taskResult = await sql`
            SELECT * FROM tasks
            WHERE id = ${taskId} AND user_id = ${user.id}
            LIMIT 1
        `;

        if (taskResult.length === 0) {
            return NextResponse.json(
                { error: 'Task not found' },
                { status: 404 }
            );
        }

        const task = taskResult[0];

        // 繰り返し設定を確認
        const recurrenceResult = await sql`
            SELECT * FROM task_recurrences
            WHERE task_id = ${taskId}
            LIMIT 1
        `;

        const hasRecurrence = recurrenceResult.length > 0;

        if (!hasRecurrence) {
            // 繰り返し設定がない場合: タスクを完全に削除
            await sql`DELETE FROM task_completions WHERE task_id = ${taskId}`;
            await sql`DELETE FROM task_recurrences WHERE task_id = ${taskId}`;
            await sql`DELETE FROM tasks WHERE id = ${taskId} AND user_id = ${user.id}`;
            
            return NextResponse.json({ success: true, message: 'タスクを削除しました' });
        }

        // 繰り返し設定がある場合
        if (!deleteOption || !targetDate) {
            return NextResponse.json(
                { error: 'deleteOption and targetDate are required for recurring tasks' },
                { status: 400 }
            );
        }

        const targetDateObj = parseISO(targetDate);
        const taskDueDate = new Date(task.due_date);

        if (deleteOption === 'this_only') {
            // 「このタスクのみ削除」: 特定日のタスクのみを除外（他の繰り返しタスクは残す）
            // 既存の除外日を削除してから、新しい除外日を追加（上書き）
            await sql`
                DELETE FROM task_exclusions 
                WHERE task_id = ${taskId} AND excluded_date = ${targetDate} AND exclusion_type = 'single'
            `;
            
            await sql`
                INSERT INTO task_exclusions (task_id, excluded_date, exclusion_type)
                VALUES (${taskId}, ${targetDate}, 'single')
                ON CONFLICT (task_id, excluded_date, exclusion_type) DO NOTHING
            `;
            
            return NextResponse.json({ success: true, message: 'このタスクを削除しました' });
        } else if (deleteOption === 'future_all') {
            // 「これ以降の繰り返しタスクすべてを削除」: 指定日以降のタスクを除外（前日までのタスクは残す）
            // 既存の除外日を削除してから、新しい除外日を追加（上書き）
            await sql`
                DELETE FROM task_exclusions 
                WHERE task_id = ${taskId} AND exclusion_type = 'after'
            `;
            
            await sql`
                INSERT INTO task_exclusions (task_id, excluded_date, exclusion_type)
                VALUES (${taskId}, ${targetDate}, 'after')
                ON CONFLICT (task_id, excluded_date, exclusion_type) DO NOTHING
            `;
            
            return NextResponse.json({ success: true, message: 'これ以降の繰り返しタスクをすべて削除しました' });
        } else {
            return NextResponse.json(
                { error: 'Invalid deleteOption' },
                { status: 400 }
            );
        }
    } catch (error) {
        console.error('Error deleting task:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
