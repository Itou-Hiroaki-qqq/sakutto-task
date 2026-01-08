import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sql } from '@/lib/db';

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

