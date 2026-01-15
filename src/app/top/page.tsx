'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Calendar from '@/components/Calendar';
import TodoList from '@/components/TodoList';
import Layout from '@/components/Layout';
import { createClient } from '@/lib/supabase/client';
import { DisplayTask } from '@/types/database';
import { format, parseISO, isSameDay } from 'date-fns';

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

    useEffect(() => {
        if (userId) {
            let isMounted = true;

            const loadTasks = async () => {
                if (!userId) return;

                setLoading(true);
                try {
                    // 段階的読み込み: まず基本情報のみを取得（高速）
                    const [tasksBasicResponse, memorialsResponse] = await Promise.all([
                        fetch(`/api/tasks?date=${format(selectedDate, 'yyyy-MM-dd')}&basic=true`),
                        fetch(`/api/memorials?date=${format(selectedDate, 'yyyy-MM-dd')}`),
                    ]);
                    if (!isMounted) return;

                    if (tasksBasicResponse.ok) {
                        const tasksBasicData = await tasksBasicResponse.json();
                        if (isMounted) {
                            // 基本情報を先に表示
                            setTasks(tasksBasicData.tasks || []);
                            setOverdueDates([]); // 基本情報取得時は過去タスク情報は取得しない
                        }

                        // バックグラウンドで完了状態を取得して更新
                        if (tasksBasicData.tasks && tasksBasicData.tasks.length > 0) {
                            try {
                                const completionResponse = await fetch('/api/tasks', {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        tasks: tasksBasicData.tasks,
                                        date: format(selectedDate, 'yyyy-MM-dd'),
                                    }),
                                });
                                if (!isMounted) return;

                                if (completionResponse.ok) {
                                    const completionData = await completionResponse.json();
                                    if (isMounted) {
                                        setTasks(completionData.tasks || tasksBasicData.tasks);
                                    }
                                }
                            } catch (error) {
                                console.error('Failed to load completion status:', error);
                            }
                        }

                        // 現在日の場合、未完了の過去タスクがある日を取得（バックグラウンド）
                        const today = new Date();
                        if (isSameDay(selectedDate, today)) {
                            try {
                                const fullTasksResponse = await fetch(`/api/tasks?date=${format(selectedDate, 'yyyy-MM-dd')}`);
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
                    }

                    if (memorialsResponse.ok) {
                        const memorialsData = await memorialsResponse.json();
                        if (isMounted) {
                            setMemorials(memorialsData.memorials || []);
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

        // 楽観的UI更新
        setTasks((prevTasks) =>
            prevTasks.map((task) =>
                task.task_id === taskId ? { ...task, completed } : task
            )
        );

        try {
            // サーバーに送信
            const response = await fetch('/api/tasks/completion', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taskId,
                    date: format(selectedDate, 'yyyy-MM-dd'),
                    completed,
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to update completion status');
            }
        } catch (error) {
            console.error('Failed to toggle completion:', error);
            // エラー時は元に戻す（楽観的UI更新をロールバック）
            setTasks((prevTasks) =>
                prevTasks.map((task) =>
                    task.task_id === taskId ? { ...task, completed: !completed } : task
                )
            );
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