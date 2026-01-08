'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Calendar from '@/components/Calendar';
import TodoList from '@/components/TodoList';
import Layout from '@/components/Layout';
import { createClient } from '@/lib/supabase/client';
import { DisplayTask } from '@/types/database';
import { format, parseISO } from 'date-fns';

export default function TopPage() {
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
    const [userId, setUserId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

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
            loadTasks();
        }
    }, [userId, selectedDate]);

    const loadTasks = async () => {
        if (!userId) return;

        setLoading(true);
        try {
            const response = await fetch(
                `/api/tasks?date=${format(selectedDate, 'yyyy-MM-dd')}`
            );
            if (response.ok) {
                const data = await response.json();
                setTasks(data.tasks || []);
            }
        } catch (error) {
            console.error('Failed to load tasks:', error);
        } finally {
            setLoading(false);
        }
    };

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

        try {
            // 楽観的UI更新
            setTasks((prevTasks) =>
                prevTasks.map((task) =>
                    task.task_id === taskId ? { ...task, completed } : task
                )
            );

            // サーバーに送信
            await fetch('/api/tasks/completion', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taskId,
                    date: format(selectedDate, 'yyyy-MM-dd'),
                    completed,
                }),
            });
        } catch (error) {
            console.error('Failed to toggle completion:', error);
            // エラー時は元に戻す
            loadTasks();
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
                            />
                        )}
                    </div>
                </div>
            </div>
        </Layout>
    );
}

