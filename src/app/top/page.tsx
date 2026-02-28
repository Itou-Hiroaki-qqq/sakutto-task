'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Calendar from '@/components/Calendar';
import TodoList from '@/components/TodoList';
import Layout from '@/components/Layout';
import { createClient } from '@/lib/supabase/client';
import { DisplayTask } from '@/types/database';
import { format, parseISO, isSameDay, addMonths, subMonths, addDays, subDays, startOfDay, differenceInDays } from 'date-fns';
import {
    getCachedTasksForDateWithoutTTL,
    getTasksOverride,
    clearTasksOverride,
    updateTasksCache,
    isWithinCurrentMonthRange,
} from '@/lib/tasksCache';

// API取得データをDisplayTask[]に変換
function parseTasksFromAPI(tasksRaw: any[]): DisplayTask[] {
    return (tasksRaw || []).map(task => ({
        ...task,
        date: typeof task.date === 'string' ? parseISO(task.date) : new Date(task.date),
        due_date: typeof task.due_date === 'string' ? parseISO(task.due_date) : new Date(task.due_date),
        created_at: task.created_at ? (typeof task.created_at === 'string' ? parseISO(task.created_at) : new Date(task.created_at)) : undefined,
    }));
}

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

    // 表示中の日付（fetch完了時に同じ日を表示中か確認する用）
    const selectedDateRef = useRef<Date>(selectedDate);
    useEffect(() => {
        selectedDateRef.current = selectedDate;
    }, [selectedDate]);

    // 完了トグル送信中：後から返る fetch で Optimistic 表示を上書きしないように保持
    const completionPendingRef = useRef<{ taskId: string; completed: boolean } | null>(null);

    // 認証
    useEffect(() => {
        let mounted = true;
        const run = async () => {
            const supabase = createClient();
            const { data: { user } } = await supabase.auth.getUser();
            if (!mounted) return;
            if (!user) {
                router.push('/login');
                return;
            }
            setUserId(user.id);
        };
        run();
        return () => { mounted = false; };
    }, [router]);

    // タスク編集のバックグラウンド保存失敗時（編集画面から戻ったあとエラーが判明した場合）
    useEffect(() => {
        if (!userId) return;
        try {
            const msg = sessionStorage.getItem('task_save_error');
            if (msg) {
                sessionStorage.removeItem('task_save_error');
                alert(msg);
            }
        } catch (_) {}
    }, [userId]);

    // 日付切り替え・初回ロード: 1) localStorage即表示 2) API fetch → setState(latest)
    useEffect(() => {
        if (!userId) return;

        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const mountedRef = { current: true };

        const load = async () => {
            const override = getTasksOverride(userId, dateStr);
            let usedOverrideInThisLoad = false;
            if (override) {
                setTasks(override);
                setLoading(false);
                clearTasksOverride(userId, dateStr);
                usedOverrideInThisLoad = true;
            } else {
                const cached = getCachedTasksForDateWithoutTTL(userId, selectedDate);
                if (cached !== null && cached.length >= 0 && isWithinCurrentMonthRange(selectedDate)) {
                    setTasks(cached);
                    setLoading(false);
                } else {
                    setLoading(true);
                }
            }

            try {
                const [tasksRes, memorialsRes] = await Promise.all([
                    fetch(`/api/tasks?date=${dateStr}`),
                    fetch(`/api/memorials?date=${dateStr}`),
                ]);

                if (!mountedRef.current) return;

                if (tasksRes.ok) {
                    const data = await tasksRes.json();
                    const latest = parseTasksFromAPI(data.tasks || []);

                    if (format(selectedDateRef.current, 'yyyy-MM-dd') === dateStr) {
                        if (!usedOverrideInThisLoad) {
                            const pending = completionPendingRef.current;
                            const toSet = pending
                                ? latest.map((t) => (t.task_id === pending.taskId ? { ...t, completed: pending.completed } : t))
                                : latest;
                            setTasks(toSet);
                            if (isWithinCurrentMonthRange(selectedDate)) {
                                updateTasksCache(
                                    userId,
                                    { [dateStr]: toSet },
                                    format(subMonths(selectedDate, 1), 'yyyy-MM-dd'),
                                    format(addMonths(selectedDate, 2), 'yyyy-MM-dd')
                                );
                            }
                        }
                    }

                    const today = startOfDay(new Date());
                    if (isSameDay(selectedDate, today) && data.overdueDates) {
                        setOverdueDates(data.overdueDates.map((d: string) => parseISO(d)));
                    }
                }

                if (memorialsRes.ok) {
                    const data = await memorialsRes.json();
                    if (mountedRef.current) setMemorials(data.memorials || []);
                }
            } catch (e) {
                console.error('Failed to load tasks:', e);
            } finally {
                if (mountedRef.current) setLoading(false);
            }
        };

        load();
        return () => { mountedRef.current = false; };
    }, [userId, selectedDate]);

    // URLパラメータと日付の同期（URL が変わったときだけ URL → state。カレンダークリックでは URL を更新しないため selectedDate は依存に含めない）
    useEffect(() => {
        const dateParam = searchParams.get('date');
        if (!dateParam) return;

        const today = startOfDay(new Date());
        try {
            const parsed = parseISO(dateParam);
            const newStr = format(parsed, 'yyyy-MM-dd');
            setSelectedDate((prev) => {
                if (format(prev, 'yyyy-MM-dd') === newStr) return prev;
                return parsed;
            });
            setDisplayMonth(parsed);
        } catch {
            setSelectedDate((prev) => {
                if (format(prev, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd')) return prev;
                return today;
            });
            setDisplayMonth(today);
        }
    }, [searchParams]);

    // プリフェッチ: API取得 → localStorage に保存のみ（setState しない）
    useEffect(() => {
        if (!userId) return;
        if (!isWithinCurrentMonthRange(new Date())) return;

        const today = startOfDay(new Date());
        const dates: Date[] = [];
        const start = subMonths(today, 1);
        const end = addMonths(today, 2);
        let cur = startOfDay(start);
        while (cur <= end) {
            if (!isSameDay(cur, today)) dates.push(new Date(cur));
            cur = addDays(cur, 1);
        }
        dates.sort((a, b) => {
            const dA = Math.abs(differenceInDays(a, today));
            const dB = Math.abs(differenceInDays(b, today));
            return dA !== dB ? dA - dB : a.getTime() - b.getTime();
        });

        const phases = [
            dates.filter(d => Math.abs(differenceInDays(d, today)) <= 1),
            dates.filter(d => {
                const diff = Math.abs(differenceInDays(d, today));
                return diff > 1 && diff <= 7;
            }),
            dates.filter(d => Math.abs(differenceInDays(d, today)) > 7),
        ];
        const delays = [100, 500, 1000];
        const mountedRef = { current: true };

        phases.forEach((phaseDates, i) => {
            setTimeout(async () => {
                if (!mountedRef.current) return;
                const toFetch = phaseDates.filter(d => {
                    const c = getCachedTasksForDateWithoutTTL(userId, d);
                    return c === null || c.length === 0;
                });
                for (let j = 0; j < toFetch.length; j += 8) {
                    if (!mountedRef.current) break;
                    const batch = toFetch.slice(j, j + 8);
                    await Promise.all(batch.map(async (d) => {
                        try {
                            const ds = format(d, 'yyyy-MM-dd');
                            const res = await fetch(`/api/tasks?date=${ds}`);
                            if (res.ok && isWithinCurrentMonthRange(d)) {
                                const data = await res.json();
                                const tasks = parseTasksFromAPI(data.tasks || []);
                                updateTasksCache(
                                    userId,
                                    { [ds]: tasks },
                                    format(subMonths(d, 1), 'yyyy-MM-dd'),
                                    format(addMonths(d, 2), 'yyyy-MM-dd')
                                );
                            }
                        } catch (_) {}
                    }));
                    if (j + 8 < toFetch.length) await new Promise(r => setTimeout(r, 200));
                }
            }, delays[i]);
        });

        return () => { mountedRef.current = false; };
    }, [userId]);

    const handleDateSelect = (date: Date) => {
        setSelectedDate(date);
        setDisplayMonth(date);
    };

    const handleMonthChange = (date: Date) => {
        setDisplayMonth(date);
    };

    const handleToggleCompletion = async (taskId: string, completed: boolean) => {
        if (!userId) return;

        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const previousTasks = [...tasks];

        completionPendingRef.current = { taskId, completed };
        setTasks(prev => prev.map(t => t.task_id === taskId ? { ...t, completed } : t));

        try {
            const res = await fetch('/api/tasks/completion', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId, date: dateStr, completed }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || '完了状態の更新に失敗しました');
            }

            // API 成功時: 表示はそのまま（Optimistic のまま）。キャッシュのみ更新（次回初回表示用）
            if (isWithinCurrentMonthRange(selectedDate)) {
                const updated = previousTasks.map(t => t.task_id === taskId ? { ...t, completed } : t);
                updateTasksCache(
                    userId,
                    { [dateStr]: updated },
                    format(subMonths(selectedDate, 1), 'yyyy-MM-dd'),
                    format(addMonths(selectedDate, 2), 'yyyy-MM-dd')
                );
            }
        } catch (e) {
            setTasks(previousTasks);
            try {
                const res = await fetch(`/api/tasks?date=${dateStr}`);
                if (res.ok) {
                    const data = await res.json();
                    setTasks(parseTasksFromAPI(data.tasks || []));
                }
            } catch (_) {}
            alert(e instanceof Error ? e.message : '完了状態の更新に失敗しました。');
        } finally {
            completionPendingRef.current = null;
        }
    };

    if (!userId) {
        return (
            <Layout>
                <div className="min-h-screen flex items-center justify-center">
                    <span className="loading loading-spinner loading-lg"></span>
                </div>
            </Layout>
        );
    }

    return (
        <Layout currentDate={displayMonth} onDateChange={handleMonthChange}>
            <div className="container mx-auto px-4 py-6">
                <div className="flex flex-col lg:flex-row gap-6">
                    <div className="w-full lg:w-1/3 lg:order-2">
                        <Calendar
                            currentDate={new Date()}
                            selectedDate={selectedDate}
                            displayMonth={displayMonth}
                            onDateSelect={handleDateSelect}
                            onMonthChange={handleMonthChange}
                        />
                    </div>
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
                <div className="min-h-screen flex items-center justify-center">
                    <span className="loading loading-spinner loading-lg"></span>
                </div>
            </Layout>
        }>
            <TopPageContent />
        </Suspense>
    );
}
