'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Calendar from '@/components/Calendar';
import TodoList from '@/components/TodoList';
import Layout from '@/components/Layout';
import { createClient } from '@/lib/supabase/client';
import { DisplayTask } from '@/types/database';
import { format, parseISO, isSameDay, addMonths, subMonths, addDays, subDays, startOfDay, differenceInDays } from 'date-fns';
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

                // 段階的な事前読み込みを開始（現在日より前の1ヶ月と現在日より後の2ヶ月の範囲内）
                const prefetchMountedRef = { current: isMounted };
                const today = new Date();
                prefetchMonthRange(uid, today, prefetchMountedRef);
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
            const latestTasksRaw: any[] = tasksData.tasks || [];

            // APIから取得したデータの日付をDateオブジェクトに変換
            const latestTasks: DisplayTask[] = latestTasksRaw.map(task => ({
                ...task,
                date: typeof task.date === 'string' ? parseISO(task.date) : new Date(task.date),
                due_date: typeof task.due_date === 'string' ? parseISO(task.due_date) : new Date(task.due_date),
                created_at: task.created_at ? (typeof task.created_at === 'string' ? parseISO(task.created_at) : new Date(task.created_at)) : undefined,
            }));

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
                    format(addMonths(date, 2), 'yyyy-MM-dd')
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

    // 現在日より前の1ヶ月と現在日より後の2ヶ月の範囲内の日付リストを生成（現在日から近い順にソート）
    const generateDateListForPrefetch = (centerDate: Date): Date[] => {
        const dates: Date[] = [];
        const startDate = subMonths(centerDate, 1);
        const endDate = addMonths(centerDate, 2);
        
        let currentDate = startOfDay(startDate);
        const end = startOfDay(endDate);
        
        while (currentDate <= end) {
            dates.push(new Date(currentDate));
            currentDate = addDays(currentDate, 1);
        }
        
        // 現在日から近い順にソート（今日 → 明日 → 昨日 → 明後日 → 一昨日 → ...）
        return dates.sort((a, b) => {
            const diffA = Math.abs(differenceInDays(a, centerDate));
            const diffB = Math.abs(differenceInDays(b, centerDate));
            if (diffA !== diffB) {
                return diffA - diffB;
            }
            // 同じ距離の場合、未来を優先
            return a.getTime() - b.getTime();
        });
    };

    // バッチ単位で日付のタスクを読み込む（並列リクエスト数制限付き）
    const prefetchDatesBatch = async (
        uid: string,
        dates: Date[],
        batchSize: number = 8,
        mountedRef?: { current: boolean }
    ) => {
        const dateQueue = [...dates];
        
        while (dateQueue.length > 0 && (!mountedRef || mountedRef.current)) {
            // バッチサイズ分の日付を取得
            const batch = dateQueue.splice(0, batchSize);
            
            // キャッシュがない日付のみをフィルタリング
            const datesToFetch = batch.filter(date => {
                const cached = getCachedTasksForDateWithoutTTL(uid, date);
                return cached === null || cached.length === 0;
            });
            
            if (datesToFetch.length === 0) {
                continue; // すべてキャッシュ済みならスキップ
            }
            
            // 並列でリクエストを送信
            const fetchPromises = datesToFetch.map(async (date) => {
                if (!mountedRef || mountedRef.current) {
                    try {
                        const dateStr = format(date, 'yyyy-MM-dd');
                        const response = await fetch(`/api/tasks?date=${dateStr}`);
                        
                        if (response.ok && (!mountedRef || mountedRef.current)) {
                            const data = await response.json();
                            const fetchedTasksRaw: any[] = data.tasks || [];
                            
                            // APIから取得したデータの日付をDateオブジェクトに変換
                            const fetchedTasks: DisplayTask[] = fetchedTasksRaw.map(task => ({
                                ...task,
                                date: typeof task.date === 'string' ? parseISO(task.date) : new Date(task.date),
                                due_date: typeof task.due_date === 'string' ? parseISO(task.due_date) : new Date(task.due_date),
                                created_at: task.created_at ? (typeof task.created_at === 'string' ? parseISO(task.created_at) : new Date(task.created_at)) : undefined,
                            }));
                            
                            // キャッシュに保存
                            if (isWithinCurrentMonthRange(date)) {
                                updateTasksCache(
                                    uid,
                                    { [dateStr]: fetchedTasks },
                                    format(subMonths(date, 1), 'yyyy-MM-dd'),
                                    format(addMonths(date, 2), 'yyyy-MM-dd')
                                );
                            }
                        }
                    } catch (error) {
                        // エラーは静かに無視
                        console.error(`[Prefetch] Failed to prefetch date ${format(date, 'yyyy-MM-dd')}:`, error);
                    }
                }
            });
            
            // バッチの完了を待つ
            await Promise.all(fetchPromises);
            
            // 次のバッチまで少し待機（サーバー負荷を軽減）
            if (dateQueue.length > 0) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
    };

    // 段階的な事前読み込みを実行
    const prefetchMonthRange = async (
        uid: string,
        centerDate: Date,
        mountedRef?: { current: boolean }
    ) => {
        if (!isWithinCurrentMonthRange(centerDate)) {
            return; // 範囲外の場合はスキップ
        }
        
        // 現在日より前の1ヶ月と現在日より後の2ヶ月の範囲内の日付リストを生成（現在日から近い順）
        const allDates = generateDateListForPrefetch(centerDate);
        
        // 今日は既に読み込まれているはずなので除外
        const today = startOfDay(new Date());
        const datesToPrefetch = allDates.filter(date => 
            !isSameDay(date, today)
        );
        
        // フェーズ1: ±1日（3日分、現在日を除く）
        const phase1Dates = datesToPrefetch.filter(date => {
            const diff = Math.abs(differenceInDays(date, centerDate));
            return diff <= 1;
        });
        
        // フェーズ2: ±7日（残り11日分）
        const phase2Dates = datesToPrefetch.filter(date => {
            const diff = Math.abs(differenceInDays(date, centerDate));
            return diff > 1 && diff <= 7;
        });
        
        // フェーズ3: 残り（過去1ヶ月と未来2ヶ月の残り）
        const phase3Dates = datesToPrefetch.filter(date => {
            const diff = Math.abs(differenceInDays(date, centerDate));
            return diff > 7;
        });
        
        // フェーズ1: 100ms後に開始
        setTimeout(async () => {
            if (mountedRef?.current) {
                await prefetchDatesBatch(uid, phase1Dates, 8, mountedRef);
            }
        }, 100);
        
        // フェーズ2: 500ms後に開始
        setTimeout(async () => {
            if (mountedRef?.current) {
                await prefetchDatesBatch(uid, phase2Dates, 8, mountedRef);
            }
        }, 500);
        
        // フェーズ3: 1秒後に開始
        setTimeout(async () => {
            if (mountedRef?.current) {
                await prefetchDatesBatch(uid, phase3Dates, 8, mountedRef);
            }
        }, 1000);
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
                const fetchedTasksRaw: any[] = tasksData.tasks || [];

                // APIから取得したデータの日付をDateオブジェクトに変換
                const fetchedTasks: DisplayTask[] = fetchedTasksRaw.map(task => ({
                    ...task,
                    date: typeof task.date === 'string' ? parseISO(task.date) : new Date(task.date),
                    due_date: typeof task.due_date === 'string' ? parseISO(task.due_date) : new Date(task.due_date),
                    created_at: task.created_at ? (typeof task.created_at === 'string' ? parseISO(task.created_at) : new Date(task.created_at)) : undefined,
                }));

                if (!mountedRef || mountedRef.current) {
                    setTasks(fetchedTasks);
                    
                    // 範囲内の場合はキャッシュに保存
                    if (isInRange) {
                        updateTasksCache(
                            uid,
                            { [dateStr]: fetchedTasks },
                            format(subMonths(date, 1), 'yyyy-MM-dd'),
                            format(addMonths(date, 2), 'yyyy-MM-dd')
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

        // Optimistic UI: 即座にUIを更新
        const previousTasks = [...tasks];
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
                    format(addMonths(selectedDate, 2), 'yyyy-MM-dd')
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
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || '完了状態の更新に失敗しました');
            }

            // 成功後、最新データでキャッシュを更新
            if (isWithinCurrentMonthRange(selectedDate)) {
                const updatedTasksResponse = await fetch(`/api/tasks?date=${dateStr}`);
                if (updatedTasksResponse.ok) {
                    const updatedData = await updatedTasksResponse.json();
                    if (updatedData.tasks) {
                        // APIから取得したデータの日付をDateオブジェクトに変換
                        const updatedTasksRaw: any[] = updatedData.tasks;
                        const updatedTasks: DisplayTask[] = updatedTasksRaw.map(task => ({
                            ...task,
                            date: typeof task.date === 'string' ? parseISO(task.date) : new Date(task.date),
                            due_date: typeof task.due_date === 'string' ? parseISO(task.due_date) : new Date(task.due_date),
                            created_at: task.created_at ? (typeof task.created_at === 'string' ? parseISO(task.created_at) : new Date(task.created_at)) : undefined,
                        }));
                        
                        // 今日と明日の場合は、サーバーからの最新データを直接優先（キャッシュを無視）
                        const today = startOfDay(new Date());
                        const tomorrow = addDays(today, 1);
                        const isTodayOrTomorrow = isSameDay(selectedDate, today) || isSameDay(selectedDate, tomorrow);
                        
                        if (isTodayOrTomorrow) {
                            // 今日と明日: サーバーからの最新データを直接反映
                            setTasks(updatedTasks);
                            updateTasksCache(
                                userId,
                                { [dateStr]: updatedTasks },
                                format(subMonths(selectedDate, 1), 'yyyy-MM-dd'),
                                format(addMonths(selectedDate, 2), 'yyyy-MM-dd')
                            );
                        } else {
                            // その他の日付: 従来通りキャッシュ優先（差分があれば反映）
                            setTasks((currentTasks) => {
                                const mergedTasks = compareAndMergeTasks(currentTasks, updatedTasks);
                                if (mergedTasks !== null) {
                                    // キャッシュを更新
                                    updateTasksCache(
                                        userId,
                                        { [dateStr]: mergedTasks },
                                        format(subMonths(selectedDate, 1), 'yyyy-MM-dd'),
                                        format(addMonths(selectedDate, 2), 'yyyy-MM-dd')
                                    );
                                    return mergedTasks;
                                } else {
                                    // 差分がない場合でも、念のためキャッシュを更新
                                    updateTasksCache(
                                        userId,
                                        { [dateStr]: updatedTasks },
                                        format(subMonths(selectedDate, 1), 'yyyy-MM-dd'),
                                        format(addMonths(selectedDate, 2), 'yyyy-MM-dd')
                                    );
                                    return currentTasks; // 変更がない場合は現在の状態を維持
                                }
                            });
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Failed to toggle completion:', error);
            
            // エラー時は元に戻す（Optimistic UI更新をロールバック）
            setTasks(previousTasks);
            
            // キャッシュも元に戻す
            if (isWithinCurrentMonthRange(selectedDate)) {
                const cachedTasks = getCachedTasksForDate(userId, selectedDate);
                if (cachedTasks) {
                    updateTasksCache(
                        userId,
                        { [dateStr]: cachedTasks },
                        format(subMonths(selectedDate, 1), 'yyyy-MM-dd'),
                        format(addMonths(selectedDate, 2), 'yyyy-MM-dd')
                    );
                } else {
                    clearTasksCache(userId, dateStr);
                }
            }
            
            // ユーザーにエラーを通知
            alert(error instanceof Error ? error.message : '完了状態の更新に失敗しました。もう一度お試しください。');
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