'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Calendar from '@/components/Calendar';
import TodoList from '@/components/TodoList';
import Layout from '@/components/Layout';
import { createClient } from '@/lib/supabase/client';
import { DisplayTask } from '@/types/database';
import { format, parseISO, isSameDay, addMonths, subMonths } from 'date-fns';
import {
    getCachedTasksForDate,
    getCachedTasksForDateWithoutTTL,
    updateTasksCache,
    clearTasksCache,
    isWithinCurrentMonthRange,
} from '@/lib/tasksCache';

function TopPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [selectedDate, setSelectedDate] = useState(() => {
        const dateParam = searchParams.get('date');
        if (dateParam) {
            try {
                return parseISO(dateParam);
            } catch (e) {
                return new Date();
            }
        }
        return new Date();
    });
    const [displayMonth, setDisplayMonth] = useState(() => {
        const dateParam = searchParams.get('date');
        if (dateParam) {
            try {
                return parseISO(dateParam);
            } catch (e) {
                return new Date();
            }
        }
        return new Date();
    });

    const [tasks, setTasks] = useState<DisplayTask[]>(() => {
        // 初期表示時はキャッシュがないため空配列
        // userIdが設定された後にキャッシュを読み込む
        return [];
    });
    const [memorials, setMemorials] = useState<Array<{ id: string; title: string }>>([]);
    const [overdueDates, setOverdueDates] = useState<Date[]>([]);
    const [userId, setUserId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [isUpdating, setIsUpdating] = useState(false); // バックグラウンド更新中フラグ

    useEffect(() => {
        // 認証チェックと初期キャッシュ読み込み
        let isMounted = true;

        const checkAuthAndLoadCache = async () => {
            try {
                const supabase = createClient();
                const {
                    data: { user },
                } = await supabase.auth.getUser();

                if (!isMounted) return;

                if (!user) {
                    router.push('/login');
                    return;
                }

                const uid = user.id;
                setUserId(uid);

                // キャッシュから即座に読み込む（TTLチェックなし）
                const cachedTasks = getCachedTasksForDateWithoutTTL(uid, selectedDate);
                if (cachedTasks !== null && cachedTasks.length >= 0) {
                    // キャッシュがあれば即座に表示
                    setTasks(cachedTasks);
                    setLoading(false);
                    
                        // バックグラウンドで最新データを取得して更新
                    const backgroundMountedRef = { current: true };
                    setTimeout(() => {
                        if (backgroundMountedRef.current && isMounted) {
                            loadLatestDataInBackground(uid, selectedDate, cachedTasks, backgroundMountedRef);
                        }
                    }, 100);
                } else {
                    // キャッシュがない場合はAPIから取得
                    setLoading(true);
                    loadTasksFromAPI(uid, selectedDate, true, { current: isMounted });
                }
            } catch (error) {
                if (isMounted) {
                    console.error('Failed to check auth:', error);
                    router.push('/login');
                }
            }
        };

        checkAuthAndLoadCache();

        return () => {
            isMounted = false;
        };
    }, [router, selectedDate]);

    // タスクの差分を比較して更新すべきか判定（完了状態を最優先）
    const compareAndMergeTasks = (
        cached: DisplayTask[],
        latest: DisplayTask[]
    ): DisplayTask[] | null => {
        // タスクIDをキーにしたマップを作成
        const cachedMap = new Map(cached.map(t => [t.task_id, t]));
        const latestMap = new Map(latest.map(t => [t.task_id, t]));

        let hasChanges = false;
        const merged: DisplayTask[] = [];

        // 最新データの全てのタスクを処理
        for (const latestTask of latest) {
            const cachedTask = cachedMap.get(latestTask.task_id);
            
            if (!cachedTask) {
                // 新規タスク
                merged.push(latestTask);
                hasChanges = true;
            } else {
                // 既存タスク：完了状態を最優先で更新
                if (cachedTask.completed !== latestTask.completed) {
                    merged.push(latestTask);
                    hasChanges = true;
                } else {
                    // 完了状態が同じでも、他の変更があれば更新
                    // DisplayTask型で比較可能なプロパティのみチェック
                    const taskChanged = 
                        cachedTask.title !== latestTask.title ||
                        cachedTask.notification_time !== latestTask.notification_time ||
                        cachedTask.due_date.getTime() !== latestTask.due_date.getTime() ||
                        cachedTask.date.getTime() !== latestTask.date.getTime();
                    
                    if (taskChanged) {
                        merged.push(latestTask);
                        hasChanges = true;
                    } else {
                        merged.push(cachedTask); // 変更なし
                    }
                }
            }
        }

        // キャッシュにあって最新データにないタスク（削除された）を検出
        for (const cachedTask of cached) {
            if (!latestMap.has(cachedTask.task_id)) {
                hasChanges = true;
                // 削除されたタスクは merged に含めない
            }
        }

        return hasChanges ? merged : null;
    };

    // バックグラウンドで最新データを取得して差分更新
    const loadLatestDataInBackground = async (
        uid: string,
        date: Date,
        currentCachedTasks: DisplayTask[],
        mountedRef?: { current: boolean }
    ) => {
        if (!isWithinCurrentMonthRange(date)) {
            // 範囲外の場合は通常のAPI取得
            loadTasksFromAPI(uid, date, false, mountedRef);
            return;
        }

        setIsUpdating(true);
        const dateStr = format(date, 'yyyy-MM-dd');

        try {
            // 最新データを取得
            const [tasksResponse, memorialsResponse] = await Promise.all([
                fetch(`/api/tasks?date=${dateStr}`),
                fetch(`/api/memorials?date=${dateStr}`),
            ]);

            if (mountedRef && !mountedRef.current) return;

            if (!tasksResponse.ok) {
                // エラーは静かに無視（キャッシュを表示し続ける）
                console.error('[Background Update] Failed to fetch latest tasks');
                return;
            }

            const tasksData = await tasksResponse.json();
            const latestTasks: DisplayTask[] = tasksData.tasks || [];

            // 差分比較
            const mergedTasks = compareAndMergeTasks(currentCachedTasks, latestTasks);

            if (mergedTasks !== null && (!mountedRef || mountedRef.current)) {
                // 差分があった場合のみ更新（ソフトに更新）
                setTasks(mergedTasks);
                
                // キャッシュを更新
                updateTasksCache(
                    uid,
                    { [dateStr]: mergedTasks },
                    format(subMonths(date, 1), 'yyyy-MM-dd'),
                    format(addMonths(date, 1), 'yyyy-MM-dd')
                );
            }

            // 記念日を更新
            if (memorialsResponse.ok && (!mountedRef || mountedRef.current)) {
                const memorialsData = await memorialsResponse.json();
                setMemorials(memorialsData.memorials || []);
            }

            // 現在日の場合、未完了の過去タスクがある日を取得
            const today = new Date();
            if (isSameDay(date, today) && (!mountedRef || mountedRef.current)) {
                if (tasksData.overdueDates) {
                    setOverdueDates(tasksData.overdueDates.map((d: string) => parseISO(d)));
                }
            }
        } catch (error) {
            // エラーは静かに無視（キャッシュを表示し続ける）
            console.error('[Background Update] Failed to update tasks:', error);
        } finally {
            if (!mountedRef || mountedRef.current) {
                setIsUpdating(false);
            }
        }
    };

    // APIからタスクを取得（キャッシュがない場合や範囲外の場合）
    const loadTasksFromAPI = async (
        uid: string,
        date: Date,
        showLoading: boolean,
        mountedRef?: { current: boolean }
    ) => {
        const dateStr = format(date, 'yyyy-MM-dd');

        if (showLoading) {
            setLoading(true);
        }

        try {
            const isInRange = isWithinCurrentMonthRange(date);

            // 記念日も同時に取得
            const [tasksResponse, memorialsResponse] = await Promise.all([
                fetch(`/api/tasks?date=${dateStr}`),
                fetch(`/api/memorials?date=${dateStr}`),
            ]);

            if (mountedRef && !mountedRef.current) return;

            if (tasksResponse.ok) {
                const tasksData = await tasksResponse.json();
                const fetchedTasks = tasksData.tasks || [];

                if (!mountedRef || mountedRef.current) {
                    setTasks(fetchedTasks);
                    
                    // 範囲内の場合はキャッシュに保存
                    if (isInRange) {
                        updateTasksCache(
                            uid,
                            { [dateStr]: fetchedTasks },
                            format(subMonths(date, 1), 'yyyy-MM-dd'),
                            format(addMonths(date, 1), 'yyyy-MM-dd')
                        );
                    }
                }

                // 現在日の場合、未完了の過去タスクがある日を取得
                const today = new Date();
                if (isSameDay(date, today)) {
                    if (tasksData.overdueDates && (!mountedRef || mountedRef.current)) {
                        setOverdueDates(tasksData.overdueDates.map((d: string) => parseISO(d)));
                    }
                }
            }

            if (memorialsResponse.ok) {
                const memorialsData = await memorialsResponse.json();
                if (!mountedRef || mountedRef.current) {
                    setMemorials(memorialsData.memorials || []);
                }
            }
        } catch (error) {
            if (!mountedRef || mountedRef.current) {
                console.error('Failed to load tasks:', error);
            }
        } finally {
            if ((!mountedRef || mountedRef.current) && showLoading) {
                setLoading(false);
            }
        }
    };

    useEffect(() => {
        // URLパラメータから日付を取得
        const dateParam = searchParams.get('date');
        if (dateParam) {
            try {
                const parsedDate = parseISO(dateParam);
                setSelectedDate(parsedDate);
                setDisplayMonth(parsedDate);
            } catch (e) {
                // パースエラーは無視
                const today = new Date();
                setSelectedDate(today);
                setDisplayMonth(today);
            }
        } else {
            // パラメータがない場合は現在日を設定
            const today = new Date();
            setSelectedDate(today);
            setDisplayMonth(today);
        }
    }, [searchParams]);

    // 日付が変更された時の処理
    useEffect(() => {
        if (!userId) return;

        const mountedRef = { current: true };

        const loadTasksForDate = async () => {
            const isInRange = isWithinCurrentMonthRange(selectedDate);
            
            // キャッシュから即座に読み込む（TTLチェックなし）
            const cachedTasks = getCachedTasksForDateWithoutTTL(userId, selectedDate);
            if (cachedTasks !== null && isInRange) {
                // キャッシュがあれば即座に表示
                if (mountedRef.current) {
                    setTasks(cachedTasks);
                    setLoading(false);
                }
                
                // バックグラウンドで最新データを取得して更新
                setTimeout(() => {
                    if (mountedRef.current) {
                        loadLatestDataInBackground(userId, selectedDate, cachedTasks, mountedRef);
                    }
                }, 100);
            } else {
                // キャッシュがない、または範囲外の場合はAPIから取得
                loadTasksFromAPI(userId, selectedDate, true, mountedRef);
            }
        };

        loadTasksForDate();

        return () => {
            mountedRef.current = false;
        };
    }, [userId, selectedDate]);

    const handleDateSelect = (date: Date) => {
        setSelectedDate(date);
        // 選択した日付の月にカレンダーも移動
        setDisplayMonth(date);
    };

    const handleMonthChange = (date: Date) => {
        setDisplayMonth(date);
    };

    const handleToggleCompletion = async (taskId: string, completed: boolean) => {
        if (!userId) return;

        const dateStr = format(selectedDate, 'yyyy-MM-dd');

        // 楽観的UI更新
        setTasks((prevTasks) =>
            prevTasks.map((task) =>
                task.task_id === taskId ? { ...task, completed } : task
            )
        );

        // キャッシュも即座に更新（範囲内の場合）
        if (isWithinCurrentMonthRange(selectedDate)) {
            const cachedTasks = getCachedTasksForDate(userId, selectedDate);
            if (cachedTasks) {
                const updatedTasks = cachedTasks.map((task) =>
                    task.task_id === taskId ? { ...task, completed } : task
                );
                updateTasksCache(
                    userId,
                    { [dateStr]: updatedTasks },
                    format(subMonths(selectedDate, 1), 'yyyy-MM-dd'),
                    format(addMonths(selectedDate, 1), 'yyyy-MM-dd')
                );
            }
        }

        try {
            // サーバーに送信
            const response = await fetch('/api/tasks/completion', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taskId,
                    date: dateStr,
                    completed,
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to update completion status');
            }

            // 成功後、最新データでキャッシュを更新
            if (isWithinCurrentMonthRange(selectedDate)) {
                const updatedTasksResponse = await fetch(`/api/tasks?date=${dateStr}`);
                if (updatedTasksResponse.ok) {
                    const updatedData = await updatedTasksResponse.json();
                    if (updatedData.tasks) {
                        updateTasksCache(
                            userId,
                            { [dateStr]: updatedData.tasks },
                            format(subMonths(selectedDate, 1), 'yyyy-MM-dd'),
                            format(addMonths(selectedDate, 1), 'yyyy-MM-dd')
                        );
                        setTasks(updatedData.tasks);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to toggle completion:', error);
            // エラー時は元に戻す（楽観的UI更新をロールバック）
            setTasks((prevTasks) =>
                prevTasks.map((task) =>
                    task.task_id === taskId ? { ...task, completed: !completed } : task
                )
            );
            
            // キャッシュも元に戻す
            if (isWithinCurrentMonthRange(selectedDate)) {
                clearTasksCache(userId, dateStr);
            }
        }
    };

    if (!userId) {
        return (
            <Layout>
                <div className="flex items-center justify-center min-h-screen">
                    <span className="loading loading-spinner loading-lg"></span>
                </div>
            </Layout>
        );
    }

    return (
        <Layout currentDate={displayMonth} onDateChange={handleMonthChange}>
            <div className="container mx-auto px-4 py-6">
                <div className="flex flex-col lg:flex-row gap-6">
                    {/* SPサイズ: 上部にカレンダー、PCサイズ: 右サイドにカレンダー */}
                    <div className="w-full lg:w-1/3 lg:order-2">
                        <Calendar
                            currentDate={new Date()}
                            selectedDate={selectedDate}
                            displayMonth={displayMonth}
                            onDateSelect={handleDateSelect}
                            onMonthChange={handleMonthChange}
                        />
                    </div>

                    {/* SPサイズ: カレンダーの下、PCサイズ: メイン部分にtodoゾーン */}
                    <div className="w-full lg:w-2/3 lg:order-1">
                        {loading ? (
                            <div className="flex items-center justify-center py-12">
                                <span className="loading loading-spinner loading-lg"></span>
                            </div>
                        ) : (
                            <div className={isUpdating ? 'opacity-75 transition-opacity duration-300' : 'opacity-100 transition-opacity duration-300'}>
                                <TodoList
                                    date={selectedDate}
                                    tasks={tasks}
                                    onToggleCompletion={handleToggleCompletion}
                                    memorials={memorials}
                                    overdueDates={overdueDates}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </Layout>
    );
}

export default function TopPage() {
    return (
        <Suspense fallback={
            <Layout>
                <div className="flex items-center justify-center min-h-screen">
                    <span className="loading loading-spinner loading-lg"></span>
                </div>
            </Layout>
        }>
            <TopPageContent />
        </Suspense>
    );
}