import { sql } from './db';
import { Task, TaskRecurrence, TaskCompletion, DisplayTask } from '@/types/database';
import { format, isSameDay, addDays, addWeeks, addMonths, addYears, getDay, add, endOfMonth, isBefore, startOfDay, parseISO } from 'date-fns';
import { extractTimeInMinutes, hasTimeInTitle } from './timeUtils';

// キャッシュの型定義
interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

// タスクリストのキャッシュ（userId_date をキー）
const tasksCache = new Map<string, CacheEntry<DisplayTask[]>>();

// 完了状態のキャッシュ（taskId_date をキー）
const completionCache = new Map<string, CacheEntry<TaskCompletion | null>>();

// キャッシュの有効期限（ミリ秒）
const CACHE_TTL = 30 * 1000; // 30秒

// キャッシュから値を取得（有効期限内の場合のみ）
function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
    const entry = cache.get(key);
    if (!entry) {
        return null;
    }
    
    const now = Date.now();
    if (now - entry.timestamp > CACHE_TTL) {
        cache.delete(key);
        return null;
    }
    
    return entry.data;
}

// キャッシュに値を設定
function setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
    cache.set(key, {
        data,
        timestamp: Date.now(),
    });
}

// キャッシュをクリア（特定のユーザーID、または特定のタスクIDに関連するキャッシュをクリア）
export function clearTasksCache(userId?: string, taskId?: string): void {
    if (userId) {
        // 特定ユーザーのタスクリストキャッシュをクリア
        const keysToDelete: string[] = [];
        for (const key of tasksCache.keys()) {
            if (key.startsWith(`${userId}_`)) {
                keysToDelete.push(key);
            }
        }
        for (const key of keysToDelete) {
            tasksCache.delete(key);
        }
    } else {
        // すべてのタスクリストキャッシュをクリア
        tasksCache.clear();
    }
    
    if (taskId) {
        // 特定タスクの完了状態キャッシュをクリア
        const keysToDelete: string[] = [];
        for (const key of completionCache.keys()) {
            if (key.startsWith(`${taskId}_`)) {
                keysToDelete.push(key);
            }
        }
        for (const key of keysToDelete) {
            completionCache.delete(key);
        }
    } else {
        // すべての完了状態キャッシュをクリア
        completionCache.clear();
    }
}

// 指定した日のタスクを取得（繰り返し設定を展開して表示用のタスクリストを作成）
export async function getTasksForDate(
    userId: string,
    targetDate: Date
): Promise<DisplayTask[]> {
    const dateStr = format(targetDate, 'yyyy-MM-dd');
    const cacheKey = `${userId}_${dateStr}`;
    
    // キャッシュから取得を試みる
    const cached = getCached(tasksCache, cacheKey);
    if (cached !== null) {
        return cached;
    }
    
    const today = startOfDay(new Date());
    const targetDateStart = startOfDay(targetDate);
    const isToday = isSameDay(targetDateStart, today);

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

    // 2. まず、繰り返しタスクのIDを収集して除外日を取得
    const recurringTaskIds: string[] = [];
    for (const task of tasks) {
        if (task.recurrence_type) {
            recurringTaskIds.push(task.id);
        }
    }

    // 3. バッチで除外日を取得（繰り返しタスクのみ）
    const exclusionsMap = await getTaskExclusionsBatch(recurringTaskIds);

    // 4. 表示される可能性があるタスクIDと日付のペアを収集
    const completionPairs: Array<{ taskId: string; date: Date }> = [];

    for (const task of tasks) {
        const taskDueDate = new Date(task.due_date);
        taskDueDate.setHours(0, 0, 0, 0);

        // 4-1. 単発タスク（繰り返しなし）
        if (!task.recurrence_type) {
            if (isSameDay(taskDueDate, targetDate)) {
                completionPairs.push({ taskId: task.id, date: targetDate });
            }
        } else {
            // 4-2. 繰り返しタスク: 除外日を使って該当するかチェック
            const exclusions = exclusionsMap.get(task.id) || null;
            const shouldInclude = shouldIncludeRecurringTaskWithExclusions(
                task.id,
                task.recurrence_type,
                taskDueDate,
                targetDate,
                task.custom_days,
                task.custom_unit,
                task.recurrence_weekdays,
                exclusions
            );

            if (shouldInclude) {
                completionPairs.push({ taskId: task.id, date: targetDate });
            }
        }
    }

    // 5. バッチで完了状態を取得
    const completionsMap = await getTaskCompletionsBatch(completionPairs);

    // 6. 各タスクについて、表示用のタスクリストを作成
    for (const task of tasks) {
        const taskDueDate = new Date(task.due_date);
        taskDueDate.setHours(0, 0, 0, 0);

        // 6-1. 単発タスク（繰り返しなし）
        if (!task.recurrence_type) {
            if (isSameDay(taskDueDate, targetDate)) {
                const completionKey = `${task.id}_${dateStr}`;
                const completion = completionsMap.get(completionKey);
                const isCompleted = completion?.completed || false;
                
                displayTasks.push({
                    id: `single-${task.id}`,
                    task_id: task.id,
                    title: task.title,
                    date: targetDate,
                    due_date: taskDueDate,
                    notification_time: task.notification_time || undefined,
                    completed: isCompleted,
                    is_recurring: false,
                    created_at: new Date(task.created_at),
                });
            }
        } else {
            // 6-2. 繰り返しタスク
            const exclusions = exclusionsMap.get(task.id) || null;
            const shouldInclude = shouldIncludeRecurringTaskWithExclusions(
                task.id,
                task.recurrence_type,
                taskDueDate,
                targetDate,
                task.custom_days,
                task.custom_unit,
                task.recurrence_weekdays,
                exclusions
            );

            if (shouldInclude) {
                const completionKey = `${task.id}_${dateStr}`;
                const completion = completionsMap.get(completionKey);
                const isCompleted = completion?.completed || false;
                
                displayTasks.push({
                    id: `recurring-${task.id}-${dateStr}`,
                    task_id: task.id,
                    title: task.title,
                    date: targetDate,
                    due_date: taskDueDate,
                    notification_time: task.notification_time || undefined,
                    completed: isCompleted,
                    is_recurring: true,
                    created_at: new Date(task.created_at),
                });
            }
        }
    }


    // 4. タスクを並び替え（時間表示→繰り返し指定→その他）
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

    // キャッシュに保存
    setCached(tasksCache, cacheKey, displayTasks);

    return displayTasks;
}

// 未完了の過去タスクがある日を取得（現在日の場合のみ使用、最適化版）
export async function getOverdueTaskDates(
    userId: string,
    today: Date
): Promise<Date[]> {
    const todayStart = startOfDay(today);
    
    // すべてのタスクを取得（繰り返し設定も含む）
    const tasks = await sql`
    SELECT 
        t.id,
        t.user_id,
        t.title,
        t.due_date,
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

    const overdueCompletionPairs: Array<{ taskId: string; date: Date }> = [];
    const recurringTaskIds: string[] = [];

    // まず、過去の単発タスクを収集
    for (const task of tasks) {
        const taskDueDate = new Date(task.due_date);
        taskDueDate.setHours(0, 0, 0, 0);

        if (isBefore(taskDueDate, todayStart)) {
            if (!task.recurrence_type) {
                // 単発タスクの場合
                overdueCompletionPairs.push({ taskId: task.id, date: taskDueDate });
            } else {
                // 繰り返しタスクの場合
                recurringTaskIds.push(task.id);
            }
        }
    }

    // 除外日をバッチ取得（繰り返しタスクのみ）
    const exclusionsMap = await getTaskExclusionsBatch(recurringTaskIds);

    // 繰り返しタスクの過去の出現日を効率的にチェック
    for (const task of tasks) {
        const taskDueDate = new Date(task.due_date);
        taskDueDate.setHours(0, 0, 0, 0);

        if (isBefore(taskDueDate, todayStart) && task.recurrence_type) {
            const exclusions = exclusionsMap.get(task.id) || null;
            
            // 除外日チェック: 「after」タイプの除外がある場合、その日以降はチェック不要
            let excludeAfterDate: Date | null = null;
            if (exclusions) {
                for (const exclusion of exclusions) {
                    if (exclusion.exclusion_type === 'after' && exclusion.excluded_date < todayStart) {
                        excludeAfterDate = exclusion.excluded_date;
                        break;
                    }
                }
            }

            // 除外開始日が期日より前の場合はスキップ
            if (excludeAfterDate && isBefore(excludeAfterDate, taskDueDate)) {
                continue;
            }

            // 繰り返しタイプに応じて効率的に出現日を計算
            const occurrenceDates = getRecurringOccurrenceDates(
                task.recurrence_type,
                taskDueDate,
                todayStart,
                task.custom_days,
                task.custom_unit,
                task.recurrence_weekdays,
                exclusions
            );

            // 出現日を追加
            for (const occurrenceDate of occurrenceDates) {
                overdueCompletionPairs.push({ taskId: task.id, date: occurrenceDate });
            }
        }
    }

    // 完了状態をバッチ取得
    const completionsMap = await getTaskCompletionsBatch(overdueCompletionPairs);

    // 未完了のタスクがある日を収集
    const overdueDatesSet = new Set<string>();
    for (const pair of overdueCompletionPairs) {
        const completionKey = `${pair.taskId}_${format(pair.date, 'yyyy-MM-dd')}`;
        const completion = completionsMap.get(completionKey);
        if (!completion?.completed) {
            const dateKey = format(pair.date, 'yyyy-MM-dd');
            overdueDatesSet.add(dateKey);
        }
    }

    // 日付の配列に変換して返す
    return Array.from(overdueDatesSet)
        .map(dateStr => parseISO(dateStr))
        .sort((a, b) => a.getTime() - b.getTime());
}

// 繰り返しタスクの出現日を効率的に計算（最適化版）
function getRecurringOccurrenceDates(
    recurrenceType: string,
    taskDueDate: Date,
    endDate: Date,
    customDays: number | null,
    customUnit: string | null,
    weekdays: number[] | null,
    exclusions: Array<{ excluded_date: Date; exclusion_type: string }> | null
): Date[] {
    const occurrences: Date[] = [];
    let checkDate = new Date(taskDueDate);
    const maxDays = 365; // 最大チェック日数

    // 除外日チェック用のヘルパー関数
    const isExcluded = (date: Date): boolean => {
        if (!exclusions) return false;
        for (const exclusion of exclusions) {
            if (exclusion.exclusion_type === 'single' && isSameDay(exclusion.excluded_date, date)) {
                return true;
            }
            if (exclusion.exclusion_type === 'after' && date >= exclusion.excluded_date) {
                return true;
            }
        }
        return false;
    };

    switch (recurrenceType) {
        case 'daily':
            // 毎日: 期日から今日まで1日ずつ（ただし、除外日をスキップ）
            while (isBefore(checkDate, endDate)) {
                if (!isExcluded(checkDate)) {
                    occurrences.push(new Date(checkDate));
                }
                checkDate = addDays(checkDate, 1);
                
                // 無限ループ防止
                if (Math.abs((checkDate.getTime() - taskDueDate.getTime()) / (1000 * 60 * 60 * 24)) > maxDays) {
                    break;
                }
            }
            break;

        case 'weekly':
            // 毎週: 同じ曜日のみをチェック
            const targetWeekday = getDay(taskDueDate);
            while (isBefore(checkDate, endDate)) {
                if (getDay(checkDate) === targetWeekday && !isExcluded(checkDate)) {
                    occurrences.push(new Date(checkDate));
                }
                // 次の同じ曜日までスキップ（最大1週間）
                const daysUntilNextWeekday = (targetWeekday - getDay(checkDate) + 7) % 7 || 7;
                checkDate = addDays(checkDate, daysUntilNextWeekday);
                
                if (Math.abs((checkDate.getTime() - taskDueDate.getTime()) / (1000 * 60 * 60 * 24)) > maxDays) {
                    break;
                }
            }
            break;

        case 'monthly':
            // 毎月: 同じ日のみをチェック
            const targetDay = taskDueDate.getDate();
            while (isBefore(checkDate, endDate)) {
                if (checkDate.getDate() === targetDay && !isExcluded(checkDate)) {
                    occurrences.push(new Date(checkDate));
                }
                // 次の月に進む
                checkDate = addMonths(checkDate, 1);
                
                if (Math.abs((checkDate.getTime() - taskDueDate.getTime()) / (1000 * 60 * 60 * 24)) > maxDays) {
                    break;
                }
            }
            break;

        case 'monthly_end':
            // 毎月末: その月の最終日のみをチェック
            while (isBefore(checkDate, endDate)) {
                const monthEnd = endOfMonth(checkDate);
                if (isSameDay(checkDate, monthEnd) && !isExcluded(checkDate)) {
                    occurrences.push(new Date(checkDate));
                }
                // 次の月に進む
                checkDate = addMonths(checkDate, 1);
                
                if (Math.abs((checkDate.getTime() - taskDueDate.getTime()) / (1000 * 60 * 60 * 24)) > maxDays) {
                    break;
                }
            }
            break;

        case 'yearly':
            // 毎年: 同じ月日のみをチェック
            const targetMonth = taskDueDate.getMonth();
            const targetDate = taskDueDate.getDate();
            while (isBefore(checkDate, endDate)) {
                if (checkDate.getMonth() === targetMonth && checkDate.getDate() === targetDate && !isExcluded(checkDate)) {
                    occurrences.push(new Date(checkDate));
                }
                // 次の年へ進む
                checkDate = addYears(checkDate, 1);
                
                if (Math.abs((checkDate.getTime() - taskDueDate.getTime()) / (1000 * 60 * 60 * 24)) > maxDays) {
                    break;
                }
            }
            break;

        case 'weekdays':
            // 指定曜日: 該当する曜日だけをチェック
            if (weekdays && weekdays.length > 0) {
                const weekdaySet = new Set(weekdays);
                // 期日から今日まで1日ずつチェック（指定曜日のみ）
                while (isBefore(checkDate, endDate)) {
                    if (weekdaySet.has(getDay(checkDate)) && !isExcluded(checkDate)) {
                        occurrences.push(new Date(checkDate));
                    }
                    checkDate = addDays(checkDate, 1);
                    
                    if (Math.abs((checkDate.getTime() - taskDueDate.getTime()) / (1000 * 60 * 60 * 24)) > maxDays) {
                        break;
                    }
                }
            }
            break;

        case 'custom':
            // カスタム期間: 単位に応じて効率的にチェック
            if (!customDays || customDays <= 0) break;

            if (!customUnit || customUnit === 'days') {
                // 日単位
                while (isBefore(checkDate, endDate)) {
                    const daysDiff = Math.floor((checkDate.getTime() - taskDueDate.getTime()) / (1000 * 60 * 60 * 24));
                    if (daysDiff >= 0 && daysDiff % customDays === 0 && !isExcluded(checkDate)) {
                        occurrences.push(new Date(checkDate));
                    }
                    // customDays日ずつ進める（効率化）
                    checkDate = addDays(checkDate, customDays);
                    
                    if (Math.abs((checkDate.getTime() - taskDueDate.getTime()) / (1000 * 60 * 60 * 24)) > maxDays) {
                        break;
                    }
                }
            } else if (customUnit === 'weeks') {
                // 週単位
                const weekInterval = customDays * 7;
                while (isBefore(checkDate, endDate)) {
                    const daysDiff = Math.floor((checkDate.getTime() - taskDueDate.getTime()) / (1000 * 60 * 60 * 24));
                    if (daysDiff >= 0 && daysDiff % weekInterval === 0 && !isExcluded(checkDate)) {
                        occurrences.push(new Date(checkDate));
                    }
                    checkDate = addDays(checkDate, weekInterval);
                    
                    if (Math.abs((checkDate.getTime() - taskDueDate.getTime()) / (1000 * 60 * 60 * 24)) > maxDays) {
                        break;
                    }
                }
            } else if (customUnit === 'months') {
                // 月単位: 同じ日のみをチェック
                const targetDay = taskDueDate.getDate();
                while (isBefore(checkDate, endDate)) {
                    if (checkDate.getDate() === targetDay && !isExcluded(checkDate)) {
                        const monthsDiff = (checkDate.getFullYear() - taskDueDate.getFullYear()) * 12 +
                            (checkDate.getMonth() - taskDueDate.getMonth());
                        if (monthsDiff >= 0 && monthsDiff % customDays === 0) {
                            occurrences.push(new Date(checkDate));
                        }
                    }
                    checkDate = addMonths(checkDate, 1);
                    
                    if (Math.abs((checkDate.getTime() - taskDueDate.getTime()) / (1000 * 60 * 60 * 24)) > maxDays) {
                        break;
                    }
                }
            } else if (customUnit === 'months_end') {
                // 月単位（月末）
                while (isBefore(checkDate, endDate)) {
                    const monthEnd = endOfMonth(checkDate);
                    if (isSameDay(checkDate, monthEnd) && !isExcluded(checkDate)) {
                        const monthsDiff = (checkDate.getFullYear() - taskDueDate.getFullYear()) * 12 +
                            (checkDate.getMonth() - taskDueDate.getMonth());
                        if (monthsDiff >= 0 && monthsDiff % customDays === 0) {
                            occurrences.push(new Date(checkDate));
                        }
                    }
                    checkDate = addMonths(checkDate, 1);
                    
                    if (Math.abs((checkDate.getTime() - taskDueDate.getTime()) / (1000 * 60 * 60 * 24)) > maxDays) {
                        break;
                    }
                }
            } else if (customUnit === 'years') {
                // 年単位
                const targetMonth = taskDueDate.getMonth();
                const targetDate = taskDueDate.getDate();
                while (isBefore(checkDate, endDate)) {
                    if (checkDate.getMonth() === targetMonth && checkDate.getDate() === targetDate && !isExcluded(checkDate)) {
                        const yearsDiff = checkDate.getFullYear() - taskDueDate.getFullYear();
                        if (yearsDiff >= 0 && yearsDiff % customDays === 0) {
                            occurrences.push(new Date(checkDate));
                        }
                    }
                    checkDate = addYears(checkDate, 1);
                    
                    if (Math.abs((checkDate.getTime() - taskDueDate.getTime()) / (1000 * 60 * 60 * 24)) > maxDays) {
                        break;
                    }
                }
            }
            break;
    }

    return occurrences;
}

// 繰り返しタスクが指定日に該当するかチェック（除外日データを引数で受け取る版）
function shouldIncludeRecurringTaskWithExclusions(
    taskId: string,
    recurrenceType: string,
    taskDueDate: Date,
    targetDate: Date,
    customDays: number | null,
    customUnit: string | null,
    weekdays: number[] | null,
    exclusions: Array<{ excluded_date: Date; exclusion_type: string }> | null
): boolean {
    // 期日より前の日は除外
    if (targetDate < taskDueDate) {
        return false;
    }

    // 除外日をチェック
    if (exclusions) {
        for (const exclusion of exclusions) {
            if (exclusion.exclusion_type === 'single') {
                // 特定日のみ除外
                if (isSameDay(exclusion.excluded_date, targetDate)) {
                    return false;
                }
            } else if (exclusion.exclusion_type === 'after') {
                // 指定日以降除外
                if (targetDate >= exclusion.excluded_date) {
                    return false;
                }
            }
        }
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

        case 'monthly_end':
            // 毎月末: その月の最終日
            const targetMonthEnd = endOfMonth(targetDate);
            return isSameDay(targetDate, targetMonthEnd);

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

            // 月単位（月末）の場合: その月の最終日
            if (customUnit === 'months_end') {
                const targetMonthEnd = endOfMonth(targetDate);
                if (!isSameDay(targetDate, targetMonthEnd)) {
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

// 繰り返しタスクが指定日に該当するかチェック（後方互換性のため残す、新規コードでは使用しない）
export async function shouldIncludeRecurringTask(
    taskId: string,
    recurrenceType: string,
    taskDueDate: Date,
    targetDate: Date,
    customDays: number | null,
    customUnit: string | null,
    weekdays: number[] | null
): Promise<boolean> {
    // 除外日を取得
    const exclusions = await sql`
        SELECT excluded_date, exclusion_type
        FROM task_exclusions
        WHERE task_id = ${taskId}
    `;

    const exclusionsArray = exclusions.map((row: any) => ({
        excluded_date: new Date(row.excluded_date),
        exclusion_type: row.exclusion_type,
    }));

    return shouldIncludeRecurringTaskWithExclusions(
        taskId,
        recurrenceType,
        taskDueDate,
        targetDate,
        customDays,
        customUnit,
        weekdays,
        exclusionsArray
    );
}

// タスクの完了状態を取得（単一）
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

// 複数のタスクの完了状態を一括取得（バッチクエリ）
async function getTaskCompletionsBatch(
    taskIdDatePairs: Array<{ taskId: string; date: Date }>
): Promise<Map<string, TaskCompletion>> {
    if (taskIdDatePairs.length === 0) {
        return new Map();
    }

    const completionMap = new Map<string, TaskCompletion>();
    const pairsToFetch: Array<{ taskId: string; date: Date }> = [];

    // まずキャッシュから取得を試みる
    for (const pair of taskIdDatePairs) {
        const dateStr = format(pair.date, 'yyyy-MM-dd');
        const cacheKey = `${pair.taskId}_${dateStr}`;
        const cached = getCached(completionCache, cacheKey);
        
        if (cached !== null) {
            // キャッシュヒット
            if (cached !== undefined) {
                const mapKey = `${pair.taskId}_${dateStr}`;
                completionMap.set(mapKey, cached);
            }
        } else {
            // キャッシュミス: データベースから取得する必要がある
            pairsToFetch.push(pair);
        }
    }

    // キャッシュミスしたペアだけをデータベースから取得
    if (pairsToFetch.length > 0) {
        const taskIds = [...new Set(pairsToFetch.map(p => p.taskId))];
        const dateStrs = [...new Set(pairsToFetch.map(p => format(p.date, 'yyyy-MM-dd')))];
        
        // まず、該当するtask_idとdateの範囲で取得
        const allCompletions = await sql`
        SELECT * FROM task_completions
        WHERE task_id = ANY(${taskIds})
          AND completed_date = ANY(${dateStrs})
        `;

        // ペアのSetを作成して高速検索
        const pairSet = new Set(pairsToFetch.map(p => `${p.taskId}_${format(p.date, 'yyyy-MM-dd')}`));

        for (const row of allCompletions as any[]) {
            // completed_dateをyyyy-MM-dd形式の文字列に変換
            let completedDateStr: string;
            if (row.completed_date instanceof Date) {
                completedDateStr = format(row.completed_date, 'yyyy-MM-dd');
            } else if (typeof row.completed_date === 'string') {
                // 既にyyyy-MM-dd形式の場合はそのまま、そうでない場合は変換
                if (/^\d{4}-\d{2}-\d{2}$/.test(row.completed_date)) {
                    completedDateStr = row.completed_date;
                } else {
                    completedDateStr = format(new Date(row.completed_date), 'yyyy-MM-dd');
                }
            } else {
                completedDateStr = format(new Date(row.completed_date), 'yyyy-MM-dd');
            }
            
            const key = `${row.task_id}_${completedDateStr}`;
            if (pairSet.has(key)) {
                const completion: TaskCompletion = {
                    id: row.id,
                    task_id: row.task_id,
                    completed_date: new Date(row.completed_date),
                    completed: row.completed,
                    created_at: new Date(row.created_at),
                    updated_at: row.updated_at ? new Date(row.updated_at) : new Date(row.created_at),
                };
                
                completionMap.set(key, completion);
                
                // キャッシュに保存
                setCached(completionCache, key, completion);
            }
        }

        // データベースに存在しない完了状態（null）もキャッシュに保存
        for (const pair of pairsToFetch) {
            const dateStr = format(pair.date, 'yyyy-MM-dd');
            const mapKey = `${pair.taskId}_${dateStr}`;
            if (!completionMap.has(mapKey)) {
                const cacheKey = `${pair.taskId}_${dateStr}`;
                setCached(completionCache, cacheKey, null);
            }
        }
    }

    return completionMap;
}

// 複数のタスクの除外日を一括取得（バッチクエリ）
async function getTaskExclusionsBatch(
    taskIds: string[]
): Promise<Map<string, Array<{ excluded_date: Date; exclusion_type: string }>>> {
    if (taskIds.length === 0) {
        return new Map();
    }

    const result = await sql`
    SELECT task_id, excluded_date, exclusion_type
    FROM task_exclusions
    WHERE task_id = ANY(${taskIds})
    `;

    const exclusionsMap = new Map<string, Array<{ excluded_date: Date; exclusion_type: string }>>();
    for (const row of result as any[]) {
        if (!exclusionsMap.has(row.task_id)) {
            exclusionsMap.set(row.task_id, []);
        }
        exclusionsMap.get(row.task_id)!.push({
            excluded_date: new Date(row.excluded_date),
            exclusion_type: row.exclusion_type,
        });
    }

    return exclusionsMap;
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

    let completion: TaskCompletion;
    
    if (existing.length > 0) {
        // 更新
        await sql`
        UPDATE task_completions
        SET completed = ${completed}, updated_at = CURRENT_TIMESTAMP
        WHERE task_id = ${taskId} AND completed_date = ${dateStr}
    `;
        
        const row = existing[0] as any;
        completion = {
            id: row.id,
            task_id: taskId,
            completed_date: new Date(dateStr),
            completed: completed,
            created_at: new Date(row.created_at),
            updated_at: new Date(),
        };
    } else {
        // 新規作成
        const result = await sql`
        INSERT INTO task_completions (task_id, completed_date, completed)
        VALUES (${taskId}, ${dateStr}, ${completed})
        RETURNING *
    `;
        
        const row = result[0] as any;
        completion = {
            id: row.id,
            task_id: taskId,
            completed_date: new Date(row.completed_date),
            completed: completed,
            created_at: new Date(row.created_at),
            updated_at: row.updated_at ? new Date(row.updated_at) : new Date(row.created_at),
        };
    }

    // 完了状態のキャッシュを更新
    const cacheKey = `${taskId}_${dateStr}`;
    setCached(completionCache, cacheKey, completion);
    
    // 該当するタスクリストのキャッシュをクリア（ユーザーIDが不明なため、すべてのキャッシュをクリア）
    // より効率的にするには、ユーザーIDも引数で受け取る必要があるが、互換性を保つため現状はすべてクリア
    tasksCache.clear();
}

