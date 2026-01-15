import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sql } from '@/lib/db';
import { format } from 'date-fns';

export async function GET(request: NextRequest) {
    try {
        // 認証チェック
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const userId = user.id;

        // タスクを取得
        const tasks = await sql`
            SELECT 
                id,
                title,
                due_date,
                notification_time,
                notification_enabled,
                created_at,
                updated_at
            FROM tasks
            WHERE user_id = ${userId}
            ORDER BY created_at ASC
        `;

        // タスクの繰り返し設定を取得
        const taskRecurrences = await sql`
            SELECT 
                tr.task_id,
                tr.type,
                tr.custom_days,
                tr.custom_unit,
                tr.weekdays
            FROM task_recurrences tr
            INNER JOIN tasks t ON tr.task_id = t.id
            WHERE t.user_id = ${userId}
        `;

        // タスクの除外設定を取得
        const taskExclusions = await sql`
            SELECT 
                te.task_id,
                te.excluded_date,
                te.exclusion_type
            FROM task_exclusions te
            INNER JOIN tasks t ON te.task_id = t.id
            WHERE t.user_id = ${userId}
        `;

        // 記念日を取得
        const memorials = await sql`
            SELECT 
                id,
                title,
                due_date,
                notification_time,
                notification_enabled,
                created_at,
                updated_at
            FROM memorials
            WHERE user_id = ${userId}
            ORDER BY created_at ASC
        `;

        // 記念日の繰り返し設定を取得
        const memorialRecurrences = await sql`
            SELECT 
                mr.memorial_id,
                mr.type,
                mr.custom_days,
                mr.custom_unit,
                mr.weekdays
            FROM memorial_recurrences mr
            INNER JOIN memorials m ON mr.memorial_id = m.id
            WHERE m.user_id = ${userId}
        `;

        // 日付をYYYY-MM-DD形式の文字列に変換するヘルパー関数
        const formatDate = (date: any): string => {
            if (!date) return '';
            // 既に文字列の場合はそのまま返す
            if (typeof date === 'string') {
                // YYYY-MM-DD形式か確認
                if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                    return date;
                }
                // ISO形式の場合は日付部分だけを抽出
                if (date.includes('T')) {
                    return date.split('T')[0];
                }
                return date;
            }
            // Dateオブジェクトの場合はYYYY-MM-DD形式に変換
            if (date instanceof Date) {
                return format(date, 'yyyy-MM-dd');
            }
            return String(date);
        };

        // データを構造化
        const exportData = {
            version: '1.0',
            exportedAt: new Date().toISOString(),
            tasks: tasks.map((task: any) => {
                const recurrence = taskRecurrences.find((r: any) => r.task_id === task.id);
                return {
                    id: task.id,
                    title: task.title,
                    due_date: formatDate(task.due_date),
                    notification_time: task.notification_time,
                    notification_enabled: task.notification_enabled,
                    created_at: task.created_at,
                    updated_at: task.updated_at,
                    recurrence: recurrence ? {
                        type: recurrence.type,
                        custom_days: recurrence.custom_days,
                        custom_unit: recurrence.custom_unit,
                        weekdays: recurrence.weekdays,
                    } : null,
                    exclusions: taskExclusions
                        .filter((e: any) => e.task_id === task.id)
                        .map((e: any) => ({
                            excluded_date: formatDate(e.excluded_date),
                            exclusion_type: e.exclusion_type,
                        })),
                };
            }),
            memorials: memorials.map((memorial: any) => {
                const recurrence = memorialRecurrences.find((r: any) => r.memorial_id === memorial.id);
                return {
                    id: memorial.id,
                    title: memorial.title,
                    due_date: formatDate(memorial.due_date),
                    notification_time: memorial.notification_time,
                    notification_enabled: memorial.notification_enabled,
                    created_at: memorial.created_at,
                    updated_at: memorial.updated_at,
                    recurrence: recurrence ? {
                        type: recurrence.type,
                        custom_days: recurrence.custom_days,
                        custom_unit: recurrence.custom_unit,
                        weekdays: recurrence.weekdays,
                    } : null,
                };
            }),
        };

        // JSONレスポンスを返す
        return NextResponse.json(exportData, {
            headers: {
                'Content-Type': 'application/json',
                'Content-Disposition': `attachment; filename="sakutto-task-backup-${new Date().toISOString().split('T')[0]}.json"`,
            },
        });
    } catch (error) {
        console.error('Export error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Export failed' },
            { status: 500 }
        );
    }
}
