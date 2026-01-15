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
    const [tasks, setTasks] = useState<DisplayTask[]>([]);
    const [memorials, setMemorials] = useState<Array<{ id: string; title: string }>>([]);
    const [overdueDates, setOverdueDates] = useState<Date[]>([]);
    const [userId, setUserId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // 認証チェック
        let isMounted = true;

        const checkAuth = async () => {
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

                setUserId(user.id);
            } catch (error) {
                if (isMounted) {
                    console.error('Failed to check auth:', error);
                    router.push('/login');
                }
            }
        };

        checkAuth();

        return () => {
            isMounted = false;
        };
    }, [router]);

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

    // 1ヶ月分のデータを事前取得（バックグラウンド）
    useEffect(() => {
        if (!userId) return;

        let isMounted = true;

        const prefetchMonthRange = async () => {
            try {
                const today = new Date();
                const centerDate = format(today, 'yyyy-MM-dd');
                
                // キャッシュをチェック（既にキャッシュがある場合はスキップ）
                const cached = getCachedTasksForDate(userId, today);
                if (cached !== null) {
                    // キャッシュが存在するので、事前取得をスキップ
                    return;
                }

                // バックグラウンドで1ヶ月分を取得
                const response = await fetch(`/api/tasks/range?centerDate=${centerDate}`);
                if (!isMounted || !response.ok) return;

                const data = await response.json();
                if (!isMounted) return;

                // キャッシュに保存
                updateTasksCache(userId, data.tasks, data.startDate, data.endDate);
            } catch (error) {
                console.error('Failed to prefetch month range:', error);
            }
        };

        // 少し遅延させて実行（初期表示を優先）
        const timeoutId = setTimeout(prefetchMonthRange, 500);

        return () => {
            isMounted = false;
            clearTimeout(timeoutId);
        };
    }, [userId]);

    useEffect(() => {
        if (userId) {
            let isMounted = true;

            const loadTasks = async () => {
                if (!userId) return;

                setLoading(true);
                const dateStr = format(selectedDate, 'yyyy-MM-dd');
                
                try {
                    // 現在日±1ヶ月の範囲内かチェック
                    const isInRange = isWithinCurrentMonthRange(selectedDate);
                    
                    // キャッシュから取得を試行（範囲内の場合のみ）
                    if (isInRange) {
                        const cachedTasks = getCachedTasksForDate(userId, selectedDate);
                        if (cachedTasks !== null) {
                            // キャッシュから即座に表示
                            if (isMounted) {
                                setTasks(cachedTasks);
                                setLoading(false);
                            }
                            
                            // 記念日は別途取得
                            try {
                                const memorialsResponse = await fetch(`/api/memorials?date=${dateStr}`);
                                if (isMounted && memorialsResponse.ok) {
                                    const memorialsData = await memorialsResponse.json();
                                    setMemorials(memorialsData.memorials || []);
                                }
                            } catch (error) {
                                console.error('Failed to load memorials:', error);
                            }

                            // 現在日の場合、未完了の過去タスクがある日を取得（バックグラウンド）
                            const today = new Date();
                            if (isSameDay(selectedDate, today)) {
                                try {
                                    const fullTasksResponse = await fetch(`/api/tasks?date=${dateStr}`);
                                    if (isMounted && fullTasksResponse.ok) {
                                        const fullTasksData = await fullTasksResponse.json();
                                        if (fullTasksData.overdueDates) {
                                            setOverdueDates(fullTasksData.overdueDates.map((d: string) => parseISO(d)));
                                        }
                                    }
                                } catch (error) {
                                    console.error('Failed to load overdue dates:', error);
                                }
                            }
                            
                            return;
                        }
                    }

                    // キャッシュがない、または範囲外の場合はAPIから取得
                    const [tasksBasicResponse, memorialsResponse] = await Promise.all([
                        fetch(`/api/tasks?date=${dateStr}&basic=true`),
                        fetch(`/api/memorials?date=${dateStr}`),
                    ]);
                    if (!isMounted) return;

                    if (tasksBasicResponse.ok) {
                        const tasksBasicData = await tasksBasicResponse.json();
                        if (isMounted) {
                            setTasks(tasksBasicData.tasks || []);
                            setOverdueDates([]);
                        }

                        // バックグラウンドで完了状態を取得して更新
                        if (tasksBasicData.tasks && tasksBasicData.tasks.length > 0) {
                            try {
                                const completionResponse = await fetch('/api/tasks', {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        tasks: tasksBasicData.tasks,
                                        date: dateStr,
                                    }),
                                });
                                if (!isMounted) return;

                                if (completionResponse.ok) {
                                    const completionData = await completionResponse.json();
                                    if (isMounted) {
                                        setTasks(completionData.tasks || tasksBasicData.tasks);
                                        
                                        // 範囲内の場合はキャッシュに保存
                                        if (isInRange) {
                                            updateTasksCache(
                                                userId,
                                                { [dateStr]: completionData.tasks },
                                                format(subMonths(selectedDate, 1), 'yyyy-MM-dd'),
                                                format(addMonths(selectedDate, 1), 'yyyy-MM-dd')
                                            );
                                        }
                                    }
                                }
                            } catch (error) {
                                console.error('Failed to load completion status:', error);
                            }
                        }
                    }

                    if (memorialsResponse.ok) {
                        const memorialsData = await memorialsResponse.json();
                        if (isMounted) {
                            setMemorials(memorialsData.memorials || []);
                        }
                    }

                    // 現在日の場合、未完了の過去タスクがある日を取得（バックグラウンド）
                    const today = new Date();
                    if (isSameDay(selectedDate, today)) {
                        try {
                            const fullTasksResponse = await fetch(`/api/tasks?date=${dateStr}`);
                            if (isMounted && fullTasksResponse.ok) {
                                const fullTasksData = await fullTasksResponse.json();
                                if (fullTasksData.overdueDates) {
                                    setOverdueDates(fullTasksData.overdueDates.map((d: string) => parseISO(d)));
                                }
                            }
                        } catch (error) {
                            console.error('Failed to load overdue dates:', error);
                        }
                    }
                } catch (error) {
                    if (isMounted) {
                        console.error('Failed to load tasks:', error);
                    }
                } finally {
                    if (isMounted) {
                        setLoading(false);
                    }
                }
            };

            loadTasks();

            return () => {
                isMounted = false;
            };
        }
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
                            <TodoList
                                date={selectedDate}
                                tasks={tasks}
                                onToggleCompletion={handleToggleCompletion}
                                memorials={memorials}
                                overdueDates={overdueDates}
                            />
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