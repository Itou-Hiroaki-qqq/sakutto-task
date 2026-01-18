import { DisplayTask } from '@/types/database';
import { format, addMonths, subMonths, isBefore, isAfter, parseISO, startOfDay } from 'date-fns';

// キャッシュの型定義
interface TasksCacheEntry {
    tasks: Record<string, DisplayTask[]>; // キー: 'YYYY-MM-DD', 値: DisplayTask[]
    timestamp: number; // キャッシュ作成時刻
    startDate: string; // 'YYYY-MM-DD'
    endDate: string; // 'YYYY-MM-DD'
}

// localStorage のキー
const CACHE_KEY_PREFIX = 'tasks_cache_';
const CACHE_TTL = 5 * 60 * 1000; // 5分

// キャッシュキーを生成（ユーザーIDをキーに含める）
function getCacheKey(userId: string): string {
    return `${CACHE_KEY_PREFIX}${userId}`;
}

// 現在日より前の1ヶ月と現在日より後の2ヶ月の範囲内かどうかをチェック
export function isWithinCurrentMonthRange(date: Date, centerDate: Date = new Date()): boolean {
    const startDate = subMonths(centerDate, 1);
    const endDate = addMonths(centerDate, 2);
    
    const checkDate = startOfDay(date);
    const start = startOfDay(startDate);
    const end = startOfDay(endDate);
    
    return checkDate >= start && checkDate <= end;
}

// キャッシュを取得
export function getTasksCache(userId: string): TasksCacheEntry | null {
    try {
        const key = getCacheKey(userId);
        const cached = localStorage.getItem(key);
        if (!cached) {
            return null;
        }

        const entry: TasksCacheEntry = JSON.parse(cached);
        
        // TTLチェック
        const now = Date.now();
        if (now - entry.timestamp > CACHE_TTL) {
            // 期限切れ
            localStorage.removeItem(key);
            return null;
        }

        return entry;
    } catch (error) {
        console.error('Error reading tasks cache:', error);
        return null;
    }
}

// キャッシュを保存
export function setTasksCache(
    userId: string,
    tasks: Record<string, DisplayTask[]>,
    startDate: string,
    endDate: string
): void {
    const key = getCacheKey(userId);
    const entry: TasksCacheEntry = {
        tasks,
        timestamp: Date.now(),
        startDate,
        endDate,
    };
    
    try {
        localStorage.setItem(key, JSON.stringify(entry));
    } catch (error) {
        console.error('Error saving tasks cache:', error);
        // localStorageの容量制限に達した場合は、古いキャッシュを削除して再試行
        if (error instanceof DOMException && error.name === 'QuotaExceededError') {
            console.warn('LocalStorage quota exceeded, clearing old cache');
            clearAllTasksCache();
            try {
                localStorage.setItem(key, JSON.stringify(entry));
            } catch (retryError) {
                console.error('Error saving tasks cache after clearing:', retryError);
            }
        }
    }
}

// キャッシュを取得（TTLチェックなし、表示用）
export function getTasksCacheWithoutTTL(userId: string): TasksCacheEntry | null {
    try {
        const key = getCacheKey(userId);
        const cached = localStorage.getItem(key);
        if (!cached) {
            return null;
        }

        const entry: TasksCacheEntry = JSON.parse(cached);
        return entry;
    } catch (error) {
        console.error('Error reading tasks cache:', error);
        return null;
    }
}

// 特定の日付範囲のキャッシュを取得（存在し、有効期限内の場合のみ）
export function getCachedTasksForDate(
    userId: string,
    date: Date
): DisplayTask[] | null {
    const cache = getTasksCache(userId);
    if (!cache) {
        return null;
    }

    const dateStr = format(date, 'yyyy-MM-dd');
    const tasks = cache.tasks[dateStr];
    
    if (!tasks) {
        // キャッシュに該当する日付がない
        return null;
    }

    // 日付がキャッシュの範囲内かチェック
    const cacheStart = parseISO(cache.startDate);
    const cacheEnd = parseISO(cache.endDate);
    const checkDate = startOfDay(date);
    
    if (checkDate < startOfDay(cacheStart) || checkDate > startOfDay(cacheEnd)) {
        // キャッシュの範囲外
        return null;
    }

    return tasks;
}

// 特定の日付範囲のキャッシュを取得（TTLチェックなし、初期表示用）
export function getCachedTasksForDateWithoutTTL(
    userId: string,
    date: Date
): DisplayTask[] | null {
    const cache = getTasksCacheWithoutTTL(userId);
    if (!cache) {
        return null;
    }

    const dateStr = format(date, 'yyyy-MM-dd');
    const tasks = cache.tasks[dateStr];
    
    if (!tasks) {
        // キャッシュに該当する日付がない
        return null;
    }

    // 日付がキャッシュの範囲内かチェック
    const cacheStart = parseISO(cache.startDate);
    const cacheEnd = parseISO(cache.endDate);
    const checkDate = startOfDay(date);
    
    if (checkDate < startOfDay(cacheStart) || checkDate > startOfDay(cacheEnd)) {
        // キャッシュの範囲外
        return null;
    }

    // 日付文字列をDateオブジェクトに変換
    return tasks.map(task => ({
        ...task,
        date: typeof task.date === 'string' ? parseISO(task.date) : task.date,
        due_date: typeof task.due_date === 'string' ? parseISO(task.due_date) : task.due_date,
        created_at: task.created_at ? (typeof task.created_at === 'string' ? parseISO(task.created_at) : task.created_at) : undefined,
    }));
}

// 特定の日付範囲のキャッシュを更新（既存のキャッシュとマージ）
export function updateTasksCache(
    userId: string,
    tasks: Record<string, DisplayTask[]>,
    startDate: string,
    endDate: string
): void {
    const existingCache = getTasksCache(userId);
    
    if (existingCache) {
        // 既存のキャッシュとマージ
        const mergedTasks = { ...existingCache.tasks, ...tasks };
        
        // 範囲を拡張（必要に応じて）
        const existingStart = parseISO(existingCache.startDate);
        const existingEnd = parseISO(existingCache.endDate);
        const newStart = parseISO(startDate);
        const newEnd = parseISO(endDate);
        
        const mergedStartDate = isBefore(newStart, existingStart) ? startDate : existingCache.startDate;
        const mergedEndDate = isAfter(newEnd, existingEnd) ? endDate : existingCache.endDate;
        
        setTasksCache(userId, mergedTasks, mergedStartDate, mergedEndDate);
    } else {
        // 新規キャッシュ
        setTasksCache(userId, tasks, startDate, endDate);
    }
}

// キャッシュをクリア（特定の日付範囲、または全体）
export function clearTasksCache(userId: string, dateStr?: string): void {
    try {
        const key = getCacheKey(userId);
        
        if (dateStr) {
            // 特定の日付のみクリア
            const cache = getTasksCache(userId);
            if (cache) {
                const { [dateStr]: removed, ...rest } = cache.tasks;
                setTasksCache(userId, rest, cache.startDate, cache.endDate);
            }
        } else {
            // 全体をクリア
            localStorage.removeItem(key);
        }
    } catch (error) {
        console.error('Error clearing tasks cache:', error);
    }
}

// すべてのキャッシュをクリア（デバッグ用）
export function clearAllTasksCache(): void {
    try {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith(CACHE_KEY_PREFIX)) {
                localStorage.removeItem(key);
            }
        });
    } catch (error) {
        console.error('Error clearing all tasks cache:', error);
    }
}
