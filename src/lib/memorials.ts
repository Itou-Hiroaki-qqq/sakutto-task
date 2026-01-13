import { sql } from './db';
import { DisplayMemorial } from '@/types/database';
import { format, isSameDay, addDays, addWeeks, addMonths, addYears, getDay, endOfMonth } from 'date-fns';

// 指定した日の記念日を取得（繰り返し設定を展開して表示用の記念日リストを作成）
export async function getMemorialsForDate(
    userId: string,
    targetDate: Date
): Promise<DisplayMemorial[]> {
    const dateStr = format(targetDate, 'yyyy-MM-dd');

    // 1. すべての記念日を取得（繰り返し設定も含む）
    const memorials = await sql`
    SELECT 
        m.id,
        m.user_id,
        m.title,
        m.due_date,
        m.created_at,
        mr.type as recurrence_type,
        mr.custom_days,
        mr.custom_unit,
        mr.weekdays as recurrence_weekdays
    FROM memorials m
    LEFT JOIN memorial_recurrences mr ON m.id = mr.memorial_id
    WHERE m.user_id = ${userId}
    ORDER BY m.created_at ASC
    `;

    const displayMemorials: DisplayMemorial[] = [];
    const targetDateStart = new Date(targetDate);
    targetDateStart.setHours(0, 0, 0, 0);
    const targetDateEnd = new Date(targetDate);
    targetDateEnd.setHours(23, 59, 59, 999);

    // 2. 各記念日について、指定日に該当するかチェック
    for (const memorial of memorials) {
        const memorialDueDate = new Date(memorial.due_date);
        memorialDueDate.setHours(0, 0, 0, 0);

        // 2-1. 単発記念日（繰り返しなし）
        if (!memorial.recurrence_type) {
            if (isSameDay(memorialDueDate, targetDate)) {
                displayMemorials.push({
                    id: `single-${memorial.id}`,
                    memorial_id: memorial.id,
                    title: memorial.title,
                    date: targetDate,
                    due_date: memorialDueDate,
                    is_recurring: false,
                    created_at: new Date(memorial.created_at),
                });
            }
        } else {
            // 2-2. 繰り返し記念日
            const shouldInclude = await shouldIncludeRecurringMemorial(
                memorial.id,
                memorial.recurrence_type,
                memorialDueDate,
                targetDate,
                memorial.custom_days,
                memorial.custom_unit,
                memorial.recurrence_weekdays
            );

            if (shouldInclude) {
                displayMemorials.push({
                    id: `recurring-${memorial.id}-${dateStr}`,
                    memorial_id: memorial.id,
                    title: memorial.title,
                    date: targetDate,
                    due_date: memorialDueDate,
                    is_recurring: true,
                    created_at: new Date(memorial.created_at),
                });
            }
        }
    }

    return displayMemorials;
}

// 繰り返し記念日が指定日に該当するかチェック
async function shouldIncludeRecurringMemorial(
    memorialId: string,
    recurrenceType: string,
    memorialDueDate: Date,
    targetDate: Date,
    customDays?: number,
    customUnit?: string,
    recurrenceWeekdays?: number[]
): Promise<boolean> {
    // 期日より前の日は除外
    if (targetDate < memorialDueDate) {
        return false;
    }

    // 期日と同日の場合は常に含める
    if (isSameDay(memorialDueDate, targetDate)) {
        return true;
    }

    switch (recurrenceType) {
        case 'daily':
            // 毎日: 期日以降すべて
            return true;

        case 'weekly':
            // 毎週: 同じ曜日
            return getDay(memorialDueDate) === getDay(targetDate);

        case 'monthly':
            // 毎月: 同じ日
            return memorialDueDate.getDate() === targetDate.getDate();

        case 'monthly_end':
            // 毎月末: その月の最終日
            const targetMonthEnd = endOfMonth(targetDate);
            return isSameDay(targetDate, targetMonthEnd);

        case 'yearly':
            // 毎年: 同じ月日
            return (
                memorialDueDate.getMonth() === targetDate.getMonth() &&
                memorialDueDate.getDate() === targetDate.getDate()
            );

        case 'weekdays':
            // 指定曜日
            if (!recurrenceWeekdays || recurrenceWeekdays.length === 0) return false;
            return recurrenceWeekdays.includes(getDay(targetDate));

        case 'custom':
            // カスタム期間: 単位に応じて処理
            if (!customDays || customDays <= 0) return false;

            // 単位が指定されていない場合は従来通り日数で計算
            if (!customUnit || customUnit === 'days') {
                const daysDiff = Math.floor(
                    (targetDate.getTime() - memorialDueDate.getTime()) / (1000 * 60 * 60 * 24)
                );
                return daysDiff >= 0 && daysDiff % customDays === 0;
            }

            // 週単位の場合
            if (customUnit === 'weeks') {
                const daysDiff = Math.floor(
                    (targetDate.getTime() - memorialDueDate.getTime()) / (1000 * 60 * 60 * 24)
                );
                return daysDiff >= 0 && daysDiff % (customDays * 7) === 0;
            }

            // 月単位の場合: 同じ日に表示
            if (customUnit === 'months') {
                if (memorialDueDate.getDate() !== targetDate.getDate()) {
                    return false;
                }
                const monthsDiff =
                    (targetDate.getFullYear() - memorialDueDate.getFullYear()) * 12 +
                    (targetDate.getMonth() - memorialDueDate.getMonth());
                return monthsDiff >= 0 && monthsDiff % customDays === 0;
            }

            // 月単位（月末）の場合: その月の最終日
            if (customUnit === 'months_end') {
                const targetMonthEnd = endOfMonth(targetDate);
                if (!isSameDay(targetDate, targetMonthEnd)) {
                    return false;
                }
                const monthsDiff =
                    (targetDate.getFullYear() - memorialDueDate.getFullYear()) * 12 +
                    (targetDate.getMonth() - memorialDueDate.getMonth());
                return monthsDiff >= 0 && monthsDiff % customDays === 0;
            }

            // 年単位の場合: 同じ月日に表示
            if (customUnit === 'years') {
                if (
                    memorialDueDate.getMonth() !== targetDate.getMonth() ||
                    memorialDueDate.getDate() !== targetDate.getDate()
                ) {
                    return false;
                }
                const yearsDiff = targetDate.getFullYear() - memorialDueDate.getFullYear();
                return yearsDiff >= 0 && yearsDiff % customDays === 0;
            }

            return false;

        default:
            return false;
    }
}

// すべての記念日を取得（リスト表示用）
export async function getAllMemorials(userId: string) {
    const memorials = await sql`
    SELECT 
        m.id,
        m.title,
        m.due_date,
        m.created_at,
        mr.type as recurrence_type
    FROM memorials m
    LEFT JOIN memorial_recurrences mr ON m.id = mr.memorial_id
    WHERE m.user_id = ${userId}
    ORDER BY m.due_date ASC, m.created_at ASC
    `;

    return memorials.map((m: any) => ({
        id: m.id,
        title: m.title,
        due_date: new Date(m.due_date),
        recurrence_type: m.recurrence_type || null,
        created_at: new Date(m.created_at),
    }));
}
