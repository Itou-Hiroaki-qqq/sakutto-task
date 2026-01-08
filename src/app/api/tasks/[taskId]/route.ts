import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sql } from '@/lib/db';

export async function GET(
    request: NextRequest,
    { params }: { params: { taskId: string } }
) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const taskId = params.taskId;

        // タスクを取得
        const taskResult = await sql`
        SELECT * FROM tasks
        WHERE id = ${taskId} AND user_id = ${user.id}
        LIMIT 1
    `;

        if (taskResult.length === 0) {
            return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        const task = taskResult[0];

        // 繰り返し設定を取得
        const recurrenceResult = await sql`
        SELECT * FROM task_recurrences
        WHERE task_id = ${taskId}
        LIMIT 1
    `;

        return NextResponse.json({
            task: {
                id: task.id,
                title: task.title,
                due_date: task.due_date,
                notification_enabled: task.notification_enabled,
                notification_time: task.notification_time,
            },
            recurrence: recurrenceResult.length > 0
                ? {
                    type: recurrenceResult[0].type,
                    custom_days: recurrenceResult[0].custom_days,
                    custom_unit: recurrenceResult[0].custom_unit,
                    weekdays: recurrenceResult[0].weekdays,
                }
                : null,
        });
    } catch (error) {
        console.error('Error fetching task:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

