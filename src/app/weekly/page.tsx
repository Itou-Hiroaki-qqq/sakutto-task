'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Layout from '@/components/Layout';
import TodoList from '@/components/TodoList';
import { createClient } from '@/lib/supabase/client';
import { DisplayTask } from '@/types/database';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks } from 'date-fns';
import { ja } from 'date-fns/locale';

function WeeklyPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [currentWeek, setCurrentWeek] = useState(() => {
        const weekParam = searchParams.get('week');
        return weekParam ? new Date(weekParam) : new Date();
    });
    const [tasksByDate, setTasksByDate] = useState<Map<string, DisplayTask[]>>(new Map());
    const [userId, setUserId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    // 現在の週の開始日（日曜日）と終了日（土曜日）を計算
    const weekStart = startOfWeek(currentWeek, { weekStartsOn: 0 });
    const weekEnd = endOfWeek(currentWeek, { weekStartsOn: 0 });
    const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

    useEffect(() => {
        // 認証チェック
        const checkAuth = async () => {
            const supabase = createClient();
            const {
                data: { user },
            } = await supabase.auth.getUser();

            if (!user) {
                router.push('/login');
                return;
            }

            setUserId(user.id);
        };

        checkAuth();
    }, [router]);

    useEffect(() => {
        if (userId) {
            let isMounted = true;

            const loadWeekTasks = async () => {
                if (!userId) return;

                setLoading(true);
                try {
                    const tasksMap = new Map<string, DisplayTask[]>();

                    // 1週間分のタスクを並列で取得
                    const promises = weekDays.map(async (date) => {
                        const dateStr = format(date, 'yyyy-MM-dd');
                        const response = await fetch(`/api/tasks?date=${dateStr}`);
                        if (!isMounted) return;
                        if (response.ok) {
                            const data = await response.json();
                            if (isMounted) {
                                tasksMap.set(dateStr, data.tasks || []);
                            }
                        }
                    });

                    await Promise.all(promises);
                    if (isMounted) {
                        setTasksByDate(tasksMap);
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

            loadWeekTasks();

            return () => {
                isMounted = false;
            };
        }
    }, [userId, currentWeek]);

    const handleToggleCompletion = async (
        taskId: string,
        completed: boolean,
        date: Date
    ) => {
        if (!userId) return;

        const dateStr = format(date, 'yyyy-MM-dd');
        
        // 楽観的UI更新
        setTasksByDate((prevMap) => {
            const newMap = new Map(prevMap);
            const tasks = newMap.get(dateStr) || [];
            const updatedTasks = tasks.map((task) =>
                task.task_id === taskId ? { ...task, completed } : task
            );
            newMap.set(dateStr, updatedTasks);
            return newMap;
        });

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
        } catch (error) {
            console.error('Failed to toggle completion:', error);
            // エラー時は元に戻す（楽観的UI更新をロールバック）
            setTasksByDate((prevMap) => {
                const newMap = new Map(prevMap);
                const tasks = newMap.get(dateStr) || [];
                const updatedTasks = tasks.map((task) =>
                    task.task_id === taskId ? { ...task, completed: !completed } : task
                );
                newMap.set(dateStr, updatedTasks);
                return newMap;
            });
        }
    };

    const handlePreviousWeek = () => {
        setCurrentWeek(subWeeks(currentWeek, 1));
    };

    const handleNextWeek = () => {
        setCurrentWeek(addWeeks(currentWeek, 1));
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
        <Layout currentDate={currentWeek}>
            <div className="container mx-auto px-4 py-6">
                {/* 週のナビゲーション */}
                <div className="flex items-center justify-between mb-6">
                    <button
                        onClick={handlePreviousWeek}
                        className="btn btn-sm btn-circle btn-ghost"
                    >
                        <span className="material-icons">chevron_left</span>
                    </button>
                    <h2 className="text-xl font-bold">
                        {format(weekStart, 'yyyy年M月d日', { locale: ja })} -{' '}
                        {format(weekEnd, 'M月d日', { locale: ja })}
                    </h2>
                    <button
                        onClick={handleNextWeek}
                        className="btn btn-sm btn-circle btn-ghost"
                    >
                        <span className="material-icons">chevron_right</span>
                    </button>
                </div>

                {/* 週間ビュー */}
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <span className="loading loading-spinner loading-lg"></span>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 lg:grid-cols-7 gap-4">
                        {weekDays.map((date) => {
                            const dateStr = format(date, 'yyyy-MM-dd');
                            const tasks = tasksByDate.get(dateStr) || [];
                            const isToday = format(date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');

                            return (
                                <div
                                    key={dateStr}
                                    className={`card bg-base-100 shadow-lg ${isToday ? 'ring-2 ring-primary' : ''
                                        }`}
                                >
                                    <div className="card-body p-4">
                                        <h3 className="card-title text-sm mb-2">
                                            <div className="flex flex-col">
                                                <span className="text-xs">
                                                    {format(date, 'M/d', { locale: ja })}
                                                </span>
                                                <span className="text-lg font-bold">
                                                    {format(date, 'E', { locale: ja })}
                                                </span>
                                            </div>
                                        </h3>
                                        <div className="space-y-2 max-h-[600px] overflow-y-auto">
                                            {tasks.map((task) => (
                                                <div
                                                    key={task.id}
                                                    className="flex items-center gap-2 p-2 bg-base-200 rounded text-sm"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        className="checkbox checkbox-primary checkbox-sm"
                                                        checked={task.completed}
                                                        onChange={(e) =>
                                                            handleToggleCompletion(
                                                                task.task_id,
                                                                e.target.checked,
                                                                date
                                                            )
                                                        }
                                                    />
                                                    <a
                                                        href={`/task?taskId=${task.task_id}&date=${dateStr}&returnUrl=${encodeURIComponent('/weekly')}`}
                                                        className={`flex-1 cursor-pointer text-xs ${task.completed
                                                                ? 'line-through text-base-content/50'
                                                                : 'text-base-content'
                                                            }`}
                                                    >
                                                        {task.notification_time && (
                                                            <span className="badge badge-outline badge-xs mr-1">
                                                                {task.notification_time}
                                                            </span>
                                                        )}
                                                        {task.title}
                                                    </a>
                                                </div>
                                            ))}
                                            {tasks.length === 0 && (
                                                <div className="text-center text-base-content/30 text-xs py-4">
                                                    タスクなし
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </Layout>
    );
}



export default function WeeklyPage() {
    return (
        <Suspense fallback={
            <Layout>
                <div className="flex items-center justify-center min-h-screen">
                    <span className="loading loading-spinner loading-lg"></span>
                </div>
            </Layout>
        }>
            <WeeklyPageContent />
        </Suspense>
    );
}

