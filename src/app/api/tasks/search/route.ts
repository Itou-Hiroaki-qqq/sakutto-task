import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sql } from '@/lib/db';
import { format } from 'date-fns';

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
        const query = searchParams.get('q');

        if (!query || query.trim() === '') {
            return NextResponse.json({ results: [] });
        }

        // タスクタイトルに検索ワードが含まれるタスクを検索
        const tasks = await sql`
        SELECT DISTINCT
        t.due_date,
        tr.type as recurrence_type,
        tr.custom_days,
        tr.weekdays as recurrence_weekdays
        FROM tasks t
        LEFT JOIN task_recurrences tr ON t.id = tr.task_id
        WHERE t.user_id = ${user.id}
        AND t.title ILIKE ${'%' + query + '%'}
        ORDER BY t.due_date ASC
    `;

        // 検索結果を日付ごとにグループ化
        const dateMap = new Map<string, number>();

        for (const task of tasks) {
            const dueDate = new Date(task.due_date);
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // 過去の日付から20年後までチェック
            const endDate = new Date();
            endDate.setFullYear(endDate.getFullYear() + 20);

            // 単発タスクの場合
            if (!task.recurrence_type) {
                const dateStr = format(dueDate, 'yyyy-MM-dd');
                dateMap.set(dateStr, (dateMap.get(dateStr) || 0) + 1);
            } else {
                // 繰り返しタスクの場合、繰り返しパターンを展開
                const recurringDates = getRecurringDates(
                    dueDate,
                    today,
                    endDate,
                    task.recurrence_type,
                    task.custom_days,
                    task.recurrence_weekdays
                );

                for (const date of recurringDates) {
                    const dateStr = format(date, 'yyyy-MM-dd');
                    dateMap.set(dateStr, (dateMap.get(dateStr) || 0) + 1);
                }
            }
        }

        // 日付が新しいものから古いものの順でソート
        const results = Array.from(dateMap.entries())
            .map(([date, count]) => ({ date, taskCount: count }))
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        return NextResponse.json({ results });
    } catch (error) {
        console.error('Error searching tasks:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

// 繰り返しタスクの日付を展開する関数
function getRecurringDates(
    startDate: Date,
    fromDate: Date,
    toDate: Date,
    recurrenceType: string,
    customDays: number | null,
    weekdays: number[] | null
): Date[] {
    const dates: Date[] = [];
    const current = new Date(Math.max(startDate.getTime(), fromDate.getTime()));
    current.setHours(0, 0, 0, 0);

    const end = new Date(toDate);
    end.setHours(23, 59, 59, 999);

    while (current <= end) {
        let shouldInclude = false;

        switch (recurrenceType) {
            case 'daily':
                shouldInclude = true;
                break;
            case 'weekly':
                shouldInclude = current.getDay() === startDate.getDay();
                break;
            case 'monthly':
                shouldInclude = current.getDate() === startDate.getDate();
                break;
            case 'yearly':
                shouldInclude =
                    current.getMonth() === startDate.getMonth() &&
                    current.getDate() === startDate.getDate();
                break;
            case 'weekdays':
                if (weekdays && weekdays.length > 0) {
                    shouldInclude = weekdays.includes(current.getDay());
                }
                break;
            case 'custom':
                if (customDays && customDays > 0) {
                    const daysDiff = Math.floor(
                        (current.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
                    );
                    shouldInclude = daysDiff >= 0 && daysDiff % customDays === 0;
                }
                break;
        }

        if (shouldInclude) {
            dates.push(new Date(current));
        }

        // 次の日へ
        current.setDate(current.getDate() + 1);
    }

    return dates;
}

