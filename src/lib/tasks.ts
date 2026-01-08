import { sql } from './db';
import { Task, TaskRecurrence, TaskCompletion, DisplayTask } from '@/types/database';
import { format, isSameDay, addDays, addWeeks, addMonths, addYears, getDay, add } from 'date-fns';
import { extractTimeInMinutes, hasTimeInTitle } from './timeUtils';

// 指定した日のタスクを取得（繰り返し設定を展開して表示用のタスクリストを作成）
export async function getTasksForDate(
    userId: string,
    targetDate: Date
): Promise<DisplayTask[]> {
    const dateStr = format(targetDate, 'yyyy-MM-dd');

    // 1. すべてのタスクを取得（繰り返し設定も含む）
    const tasks = await sql`
    SELECT 
        t.id,
        t.user_id,
        t.title,
        t.due_date,
        t.notification_time,
        t.created_at,
        tr.type as recurrence_type,
        tr.custom_days,
        tr.custom_unit,
        tr.weekdays as recurrence_weekdays
    FROM tasks t
    LEFT JOIN task_recurrences tr ON t.id = tr.task_id
    WHERE t.user_id = ${userId}
    ORDER BY t.created_at ASC
    `;

    const displayTasks: DisplayTask[] = [];
    const targetDateStart = new Date(targetDate);
    targetDateStart.setHours(0, 0, 0, 0);
    const targetDateEnd = new Date(targetDate);
    targetDateEnd.setHours(23, 59, 59, 999);

    // 2. 各タスクについて、指定日に該当するかチェック
    for (const task of tasks) {
        const taskDueDate = new Date(task.due_date);
        taskDueDate.setHours(0, 0, 0, 0);

        // 2-1. 単発タスク（繰り返しなし）
        if (!task.recurrence_type) {
            if (isSameDay(taskDueDate, targetDate)) {
                const completion = await getTaskCompletion(task.id, targetDate);
                displayTasks.push({
                    id: `single-${task.id}`,
                    task_id: task.id,
                    title: task.title,
                    date: targetDate,
                    due_date: taskDueDate,
                    notification_time: task.notification_time || undefined,
                    completed: completion?.completed || false,
                    is_recurring: false,
                    created_at: new Date(task.created_at),
                });
            }
        } else {
            // 2-2. 繰り返しタスク
            const shouldInclude = await shouldIncludeRecurringTask(
                task.id,
                task.recurrence_type,
                taskDueDate,
                targetDate,
                task.custom_days,
                task.custom_unit,
                task.recurrence_weekdays
            );

            if (shouldInclude) {
                const completion = await getTaskCompletion(task.id, targetDate);
                displayTasks.push({
                    id: `recurring-${task.id}-${dateStr}`,
                    task_id: task.id,
                    title: task.title,
                    date: targetDate,
                    due_date: taskDueDate,
                    notification_time: task.notification_time || undefined,
                    completed: completion?.completed || false,
                    is_recurring: true,
                    created_at: new Date(task.created_at),
                });
            }
        }
    }

    // 3. タスクを並び替え（時間表示→繰り返し指定→その他）
    displayTasks.sort((a, b) => {
        // 1. タイトルに時間表示が含まれるタスクを最上部に
        const aHasTime = hasTimeInTitle(a.title);
        const bHasTime = hasTimeInTitle(b.title);

        if (aHasTime && !bHasTime) return -1;
        if (!aHasTime && bHasTime) return 1;

        // 両方に時間表示がある場合、時間の順番で並べる
        if (aHasTime && bHasTime) {
            const aTime = extractTimeInMinutes(a.title);
            const bTime = extractTimeInMinutes(b.title);
            if (aTime !== null && bTime !== null) {
                return aTime - bTime;
            }
            // 時間が抽出できない場合は作成順
            const aCreated = a.created_at?.getTime() || 0;
            const bCreated = b.created_at?.getTime() || 0;
            return aCreated - bCreated;
        }

        // 2. 繰り返し指定があるタスクを次に
        if (a.is_recurring && !b.is_recurring) return -1;
        if (!a.is_recurring && b.is_recurring) return 1;

        // 3. その他のタスクは作成順
        const aCreated = a.created_at?.getTime() || 0;
        const bCreated = b.created_at?.getTime() || 0;
        return aCreated - bCreated;
    });

    return displayTasks;
}

// 繰り返しタスクが指定日に該当するかチェック
async function shouldIncludeRecurringTask(
    taskId: string,
    recurrenceType: string,
    taskDueDate: Date,
    targetDate: Date,
    customDays: number | null,
    customUnit: string | null,
    weekdays: number[] | null
): Promise<boolean> {
    // 期日より前の日は除外
    if (targetDate < taskDueDate) {
        return false;
    }

    // 期日と同日の場合は常に含める
    if (isSameDay(taskDueDate, targetDate)) {
        return true;
    }

    switch (recurrenceType) {
        case 'daily':
            // 毎日: 期日以降すべて
            return true;

        case 'weekly':
            // 毎週: 同じ曜日
            return getDay(taskDueDate) === getDay(targetDate);

        case 'monthly':
            // 毎月: 同じ日
            return taskDueDate.getDate() === targetDate.getDate();

        case 'yearly':
            // 毎年: 同じ月日
            return (
                taskDueDate.getMonth() === targetDate.getMonth() &&
                taskDueDate.getDate() === targetDate.getDate()
            );

        case 'weekdays':
            // 指定曜日
            if (!weekdays || weekdays.length === 0) return false;
            return weekdays.includes(getDay(targetDate));

        case 'custom':
            // カスタム期間: 単位に応じて処理
            if (!customDays || customDays <= 0) return false;

            // 単位が指定されていない場合は従来通り日数で計算（後方互換性）
            if (!customUnit || customUnit === 'days') {
                const daysDiff = Math.floor(
                    (targetDate.getTime() - taskDueDate.getTime()) / (1000 * 60 * 60 * 24)
                );
                return daysDiff >= 0 && daysDiff % customDays === 0;
            }

            // 週単位の場合
            if (customUnit === 'weeks') {
                const daysDiff = Math.floor(
                    (targetDate.getTime() - taskDueDate.getTime()) / (1000 * 60 * 60 * 24)
                );
                return daysDiff >= 0 && daysDiff % (customDays * 7) === 0;
            }

            // 月単位の場合: 同じ日に表示
            if (customUnit === 'months') {
                if (taskDueDate.getDate() !== targetDate.getDate()) {
                    return false;
                }
                const monthsDiff =
                    (targetDate.getFullYear() - taskDueDate.getFullYear()) * 12 +
                    (targetDate.getMonth() - taskDueDate.getMonth());
                return monthsDiff >= 0 && monthsDiff % customDays === 0;
            }

            // 年単位の場合: 同じ月日に表示
            if (customUnit === 'years') {
                if (
                    taskDueDate.getMonth() !== targetDate.getMonth() ||
                    taskDueDate.getDate() !== targetDate.getDate()
                ) {
                    return false;
                }
                const yearsDiff = targetDate.getFullYear() - taskDueDate.getFullYear();
                return yearsDiff >= 0 && yearsDiff % customDays === 0;
            }

            return false;

        default:
            return false;
    }
}

// タスクの完了状態を取得
async function getTaskCompletion(
    taskId: string,
    date: Date
): Promise<TaskCompletion | null> {
    const dateStr = format(date, 'yyyy-MM-dd');
    const result = await sql`
    SELECT * FROM task_completions
    WHERE task_id = ${taskId} AND completed_date = ${dateStr}
    LIMIT 1
    `;
    if (result && result.length > 0) {
        const row = result[0] as any;
        return {
            id: row.id,
            task_id: row.task_id,
            completed_date: new Date(row.completed_date),
            completed: row.completed,
            created_at: new Date(row.created_at),
            updated_at: row.updated_at ? new Date(row.updated_at) : new Date(row.created_at),
        } as TaskCompletion;
    }
    return null;
}

// タスクの完了状態を更新
export async function toggleTaskCompletion(
    taskId: string,
    date: Date,
    completed: boolean
): Promise<void> {
    const dateStr = format(date, 'yyyy-MM-dd');

    // 既存の完了状態を確認
    const existing = await sql`
    SELECT * FROM task_completions
    WHERE task_id = ${taskId} AND completed_date = ${dateStr}
    LIMIT 1
    `;

    if (existing.length > 0) {
        // 更新
        await sql`
        UPDATE task_completions
        SET completed = ${completed}, updated_at = CURRENT_TIMESTAMP
        WHERE task_id = ${taskId} AND completed_date = ${dateStr}
    `;
    } else {
        // 新規作成
        await sql`
        INSERT INTO task_completions (task_id, completed_date, completed)
        VALUES (${taskId}, ${dateStr}, ${completed})
    `;
    }
}

