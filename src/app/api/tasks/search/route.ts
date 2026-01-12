import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sql } from '@/lib/db';
import { format, getDay, endOfMonth, isSameDay } from 'date-fns';

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
        SELECT 
        t.id,
        t.title,
        t.due_date,
        tr.type as recurrence_type,
        tr.custom_days,
        tr.custom_unit,
        tr.weekdays as recurrence_weekdays
        FROM tasks t
        LEFT JOIN task_recurrences tr ON t.id = tr.task_id
        WHERE t.user_id = ${user.id}
        AND t.title ILIKE ${'%' + query + '%'}
        ORDER BY t.due_date ASC
    `;

        const results: { date: string; taskId: string; title: string }[] = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 過去1年から20年後までチェック
        const startDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - 1);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date();
        endDate.setFullYear(endDate.getFullYear() + 20);
        endDate.setHours(23, 59, 59, 999);

        for (const task of tasks) {
            const dueDate = new Date(task.due_date);
            dueDate.setHours(0, 0, 0, 0);

            // 単発タスクの場合
            if (!task.recurrence_type) {
                // 期日が範囲内の場合のみ追加
                if (dueDate >= startDate && dueDate <= endDate) {
                    results.push({
                        date: format(dueDate, 'yyyy-MM-dd'),
                        taskId: task.id,
                        title: task.title,
                    });
                }
            } else {
                // 繰り返しタスクの場合、繰り返しパターンを展開
                const recurringDates = await getRecurringDatesWithExclusions(
                    task.id,
                    dueDate,
                    startDate,
                    endDate,
                    task.recurrence_type,
                    task.custom_days,
                    task.custom_unit,
                    task.recurrence_weekdays
                );

                for (const date of recurringDates) {
                    results.push({
                        date: format(date, 'yyyy-MM-dd'),
                        taskId: task.id,
                        title: task.title,
                    });
                }
            }
        }

        // 日付が新しいものから古いものの順でソート（同じ日付の場合はタイトル順）
        results.sort((a, b) => {
            const dateCompare = new Date(b.date).getTime() - new Date(a.date).getTime();
            if (dateCompare !== 0) return dateCompare;
            return a.title.localeCompare(b.title);
        });

        return NextResponse.json({ results });
    } catch (error) {
        console.error('Error searching tasks:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

// 繰り返しタスクの日付を展開する関数（除外日も考慮）
async function getRecurringDatesWithExclusions(
    taskId: string,
    startDate: Date,
    fromDate: Date,
    toDate: Date,
    recurrenceType: string,
    customDays: number | null,
    customUnit: string | null,
    weekdays: number[] | null
): Promise<Date[]> {
    const dates: Date[] = [];
    const current = new Date(Math.max(startDate.getTime(), fromDate.getTime()));
    current.setHours(0, 0, 0, 0);

    const end = new Date(toDate);
    end.setHours(23, 59, 59, 999);

    // 除外日を事前に取得
    const exclusions = await sql`
        SELECT excluded_date, exclusion_type
        FROM task_exclusions
        WHERE task_id = ${taskId}
    `;

    const excludedDates = new Set<string>();
    const excludedAfterDate = new Map<string, Date>();
    for (const exclusion of exclusions) {
        const excludedDate = new Date(exclusion.excluded_date);
        if (exclusion.exclusion_type === 'single') {
            excludedDates.add(format(excludedDate, 'yyyy-MM-dd'));
        } else if (exclusion.exclusion_type === 'after') {
            excludedAfterDate.set(taskId, excludedDate);
        }
    }

    while (current <= end) {
        // 除外日チェック
        const currentDateStr = format(current, 'yyyy-MM-dd');
        if (excludedDates.has(currentDateStr)) {
            current.setDate(current.getDate() + 1);
            continue;
        }

        const afterExclusion = excludedAfterDate.get(taskId);
        if (afterExclusion && current >= afterExclusion) {
            current.setDate(current.getDate() + 1);
            continue;
        }

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
            case 'monthly_end':
                // 毎月末: その月の最終日
                const currentMonthEnd = endOfMonth(current);
                shouldInclude = isSameDay(current, currentMonthEnd);
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
                if (!customDays || customDays <= 0) break;

                if (!customUnit || customUnit === 'days') {
                    const daysDiff = Math.floor(
                        (current.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
                    );
                    shouldInclude = daysDiff >= 0 && daysDiff % customDays === 0;
                } else if (customUnit === 'weeks') {
                    const daysDiff = Math.floor(
                        (current.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
                    );
                    shouldInclude = daysDiff >= 0 && daysDiff % (customDays * 7) === 0;
                } else if (customUnit === 'months') {
                    if (current.getDate() !== startDate.getDate()) {
                        shouldInclude = false;
                    } else {
                        const monthsDiff =
                            (current.getFullYear() - startDate.getFullYear()) * 12 +
                            (current.getMonth() - startDate.getMonth());
                        shouldInclude = monthsDiff >= 0 && monthsDiff % customDays === 0;
                    }
                } else if (customUnit === 'years') {
                    if (
                        current.getMonth() !== startDate.getMonth() ||
                        current.getDate() !== startDate.getDate()
                    ) {
                        shouldInclude = false;
                    } else {
                        const yearsDiff = current.getFullYear() - startDate.getFullYear();
                        shouldInclude = yearsDiff >= 0 && yearsDiff % customDays === 0;
                    }
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

