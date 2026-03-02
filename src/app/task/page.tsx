'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { format, parseISO, subMonths, addMonths } from 'date-fns';
import { ja } from 'date-fns/locale';
import DatePicker from '@/components/DatePicker';
import { RecurrenceType } from '@/types/database';
import { clearTasksCache as clearClientTasksCache, getCachedTasksForDateWithoutTTL, isWithinCurrentMonthRange, setTasksOverride, updateTasksCache } from '@/lib/tasksCache';
import { DisplayTask } from '@/types/database';

function TaskEditPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [userId, setUserId] = useState<string | null>(null);

    // URLパラメータから取得
    const taskIdParam = searchParams.get('taskId');
    const dateParam = searchParams.get('date');
    const initialDate = dateParam ? parseISO(dateParam) : new Date();

    // フォーム状態
    const [title, setTitle] = useState('');
    const [timeSuggestion, setTimeSuggestion] = useState<{ pattern: string; converted: string; index: number } | null>(null);
    const [dismissedPatterns, setDismissedPatterns] = useState<Set<string>>(new Set()); // 無効化されたパターン（位置:パターン）
    const titleInputRef = useRef<HTMLTextAreaElement>(null);
    const [dueDate, setDueDate] = useState(initialDate);
    const [notificationEnabled, setNotificationEnabled] = useState(false);
    const [notificationTime, setNotificationTime] = useState('');
    const [recurrenceType, setRecurrenceType] = useState<RecurrenceType | null>(null);
    const [customDays, setCustomDays] = useState<number | null>(null);
    const [customUnit, setCustomUnit] = useState<'days' | 'weeks' | 'months' | 'months_end' | 'years'>('days');
    const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([]);

    const [showDatePicker, setShowDatePicker] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [showSaveScopeDialog, setShowSaveScopeDialog] = useState(false);

    // 認証とタスク取得を並列実行して遷移を速くする
    useEffect(() => {
        const dateParam = searchParams.get('date');
        const supabase = createClient();

        const run = async () => {
            const [authResult, taskResponse] = await Promise.all([
                supabase.auth.getUser(),
                taskIdParam ? fetch(`/api/tasks/${taskIdParam}`) : Promise.resolve(null),
            ]);

            const { data: { user } } = authResult;
            if (!user) {
                router.push('/login');
                return;
            }
            setUserId(user.id);

            if (!taskIdParam) {
                const newDateParam = searchParams.get('date');
                if (newDateParam) {
                    try {
                        setDueDate(parseISO(newDateParam));
                    } catch {
                        // パースエラーは無視
                    }
                }
                setLoading(false);
                return;
            }

            if (!taskResponse) {
                setLoading(false);
                return;
            }

            try {
                if (taskResponse.ok) {
                    const data = await taskResponse.json();
                    if (!data.task) {
                        alert('タスクデータが見つかりませんでした');
                        router.back();
                        return;
                    }
                    setTitle(data.task.title || '');
                    const taskDueDate = data.task.due_date ? new Date(data.task.due_date) : initialDate;
                    if (data.recurrence && dateParam) {
                        try {
                            setDueDate(parseISO(dateParam));
                        } catch {
                            setDueDate(taskDueDate);
                        }
                    } else {
                        setDueDate(taskDueDate);
                    }
                    setNotificationEnabled(data.task.notification_enabled || false);
                    setNotificationTime(data.task.notification_time || '');
                    if (data.recurrence) {
                        setRecurrenceType(data.recurrence.type);
                        if (data.recurrence.type === 'custom' && data.recurrence.custom_days) {
                            if (data.recurrence.custom_unit) {
                                setCustomUnit(data.recurrence.custom_unit as 'days' | 'weeks' | 'months' | 'months_end' | 'years');
                                setCustomDays(data.recurrence.custom_days);
                            } else {
                                const days = data.recurrence.custom_days;
                                if (days % 365 === 0) {
                                    setCustomUnit('years');
                                    setCustomDays(days / 365);
                                } else if (days % 30 === 0) {
                                    setCustomUnit('months');
                                    setCustomDays(days / 30);
                                } else if (days % 7 === 0) {
                                    setCustomUnit('weeks');
                                    setCustomDays(days / 7);
                                } else {
                                    setCustomUnit('days');
                                    setCustomDays(days);
                                }
                            }
                        } else {
                            setCustomDays(data.recurrence.custom_days || null);
                        }
                        setSelectedWeekdays(data.recurrence.weekdays || []);
                    } else {
                        setRecurrenceType(null);
                        setCustomDays(null);
                        setCustomUnit('days');
                        setSelectedWeekdays([]);
                    }
                } else {
                    const errorData = await taskResponse.json();
                    if (taskResponse.status === 404) {
                        alert('タスクが見つかりませんでした。既に削除されている可能性があります。');
                        router.back();
                    } else {
                        alert(`タスクの読み込みに失敗しました: ${errorData.error || 'Unknown error'}`);
                    }
                }
            } catch (e) {
                console.error('Failed to load task:', e);
                alert('タスクの読み込み中にエラーが発生しました');
            } finally {
                setLoading(false);
            }
        };

        if (taskIdParam) setLoading(true);
        run();
    }, [router, taskIdParam, searchParams]);

    // ローディングが完了したらタイトル入力欄にフォーカス
    useEffect(() => {
        if (!loading && userId) {
            // DOMが確実にレンダリングされた後にフォーカスを当てる
            const timer = setTimeout(() => {
                if (titleInputRef.current) {
                    titleInputRef.current.focus();
                }
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [loading, userId]);

    const handleSave = () => {
        if (!title.trim() || !userId) {
            alert('タイトルを入力してください');
            return;
        }
        // 繰り返し予定の編集時は範囲選択ダイアログを表示
        if (taskIdParam && recurrenceType !== null && searchParams.get('date')) {
            setShowSaveScopeDialog(true);
            return;
        }
        performSave();
    };

    const performSave = async (updateScope?: 'this_only' | 'all_future') => {
        if (!title.trim() || !userId) {
            alert('タイトルを入力してください');
            return;
        }

        setShowSaveScopeDialog(false);

        // 通知設定が有効な場合、メールアドレスまたはWeb Push設定の確認
        if (notificationEnabled && notificationTime) {
            try {
                const settingsResponse = await fetch('/api/settings/notifications');
                if (settingsResponse.ok) {
                    const settingsData = await settingsResponse.json();
                    const hasEmail = settingsData.settings?.email && settingsData.settings?.email_notification_enabled;

                    if (!hasEmail) {
                        const returnDate = searchParams.get('date');
                        const returnUrl = `/task${taskIdParam ? `?taskId=${taskIdParam}` : ''}${returnDate ? `&date=${returnDate}` : ''}`;
                        const confirmed = confirm(
                            '通知を送信するには、メールアドレスの設定が必要です。\n通知設定ページに移動しますか？'
                        );
                        if (confirmed) {
                            router.push(`/settings/notifications?returnUrl=${encodeURIComponent(returnUrl)}`);
                            return;
                        } else {
                            return;
                        }
                    }
                }
            } catch (error) {
                console.error('Failed to check notification settings:', error);
            }
        }

        let customDaysToSave: number | null = null;
        let customUnitToSave: 'days' | 'weeks' | 'months' | 'months_end' | 'years' | null = null;
        if (recurrenceType === 'custom' && customDays) {
            customDaysToSave = customDays;
            customUnitToSave = customUnit;
            if (customUnit === 'days') customUnitToSave = null;
        }

        const payload: Record<string, unknown> = {
            taskId: taskIdParam,
            title: title.trim(),
            dueDate: format(dueDate, 'yyyy-MM-dd'),
            notificationEnabled,
            notificationTime: notificationEnabled ? notificationTime : null,
            recurrenceType,
            customDays: customDaysToSave,
            customUnit: customUnitToSave,
            selectedWeekdays: recurrenceType === 'weekdays' ? selectedWeekdays : null,
        };
        if (taskIdParam && recurrenceType && updateScope) {
            payload.updateScope = updateScope;
            const dateParam = searchParams.get('date');
            if (dateParam) payload.targetDate = dateParam;
        }

        const returnDate = searchParams.get('date');
        const returnUrl = searchParams.get('returnUrl') || '/top';
        const dateStrForCache = updateScope === 'this_only' && returnDate ? returnDate : format(dueDate, 'yyyy-MM-dd');
        const occurrenceDate = parseISO(dateStrForCache);

        // 楽観的キャッシュ更新（React State の唯一の真実はトップの setState；キャッシュは初回表示用なので即反映させる）
        if (userId && updateScope !== 'all_future' && isWithinCurrentMonthRange(occurrenceDate)) {
            const tempId = taskIdParam ?? `temp-${Date.now()}`;
            const optimisticTask: DisplayTask = {
                id: tempId,
                task_id: tempId,
                title: title.trim(),
                date: occurrenceDate,
                due_date: dueDate,
                notification_time: notificationEnabled ? notificationTime : undefined,
                completed: false,
                is_recurring: recurrenceType !== null,
                created_at: new Date(),
            };
            const existing = getCachedTasksForDateWithoutTTL(userId, occurrenceDate) ?? [];
            const newList = taskIdParam
                ? existing.map((t) => (t.task_id === taskIdParam ? optimisticTask : t))
                : [...existing, optimisticTask];
            updateTasksCache(
                userId,
                { [dateStrForCache]: newList },
                format(subMonths(occurrenceDate, 1), 'yyyy-MM-dd'),
                format(addMonths(occurrenceDate, 2), 'yyyy-MM-dd')
            );
            setTasksOverride(userId, dateStrForCache, newList);
        }
        if (userId && updateScope === 'all_future') {
            clearClientTasksCache(userId);
        }

        // UI は即切り替え（戻る）
        if (returnDate) {
            router.push(`${returnUrl}?date=${returnDate}`);
        } else {
            router.push(returnUrl);
        }

        // 保存はバックグラウンドで実行
        (async () => {
            try {
                const response = await fetch('/api/tasks', {
                    method: taskIdParam ? 'PUT' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });

                if (response.ok) {
                    if (userId && (updateScope !== 'all_future')) {
                        const datesToRefresh = new Set<string>([dateStrForCache]);
                        if (updateScope === 'this_only' && returnDate) datesToRefresh.add(returnDate);
                        try {
                            for (const ds of datesToRefresh) {
                                const res = await fetch(`/api/tasks?date=${ds}`);
                                if (res.ok && isWithinCurrentMonthRange(parseISO(ds))) {
                                    const data = await res.json();
                                    const tasksRaw = (data.tasks || []).map((t: any) => ({
                                        ...t,
                                        date: typeof t.date === 'string' ? parseISO(t.date) : new Date(t.date),
                                        due_date: typeof t.due_date === 'string' ? parseISO(t.due_date) : new Date(t.due_date),
                                        created_at: t.created_at ? (typeof t.created_at === 'string' ? parseISO(t.created_at) : new Date(t.created_at)) : undefined,
                                    }));
                                    updateTasksCache(
                                        userId,
                                        { [ds]: tasksRaw },
                                        format(subMonths(parseISO(ds), 1), 'yyyy-MM-dd'),
                                        format(addMonths(parseISO(ds), 2), 'yyyy-MM-dd')
                                    );
                                }
                            }
                        } catch (_) {}
                    }
                    if (userId && recurrenceType && updateScope === 'all_future') {
                        clearClientTasksCache(userId);
                    }
                } else {
                    const err = await response.json().catch(() => ({}));
                    if (userId && isWithinCurrentMonthRange(occurrenceDate)) {
                        clearClientTasksCache(userId, dateStrForCache);
                    }
                    try {
                        sessionStorage.setItem('task_save_error', err?.error ?? '保存に失敗しました');
                    } catch (_) {}
                }
            } catch (_) {
                if (userId && isWithinCurrentMonthRange(occurrenceDate)) {
                    clearClientTasksCache(userId, dateStrForCache);
                }
                try {
                    sessionStorage.setItem('task_save_error', '保存に失敗しました');
                } catch (_) {}
            }
        })();
    };

    // 時刻を5分刻みに丸める関数
    const roundTo5Minutes = (timeString: string): string => {
        if (!timeString || !timeString.includes(':')) {
            return timeString;
        }

        const [hours, minutes] = timeString.split(':').map(Number);
        const roundedMinutes = Math.round(minutes / 5) * 5;

        if (roundedMinutes === 60) {
            return `${String(hours + 1).padStart(2, '0')}:00`;
        }

        return `${String(hours).padStart(2, '0')}:${String(roundedMinutes).padStart(2, '0')}`;
    };

    const handleNotificationTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setNotificationTime(value);
    };

    const handleNotificationTimeBlur = (e: React.FocusEvent<HTMLInputElement>) => {
        const value = e.target.value;
        if (value) {
            const rounded = roundTo5Minutes(value);
            setNotificationTime(rounded);
        }
    };

    const handleWeekdayToggle = (weekday: number) => {
        setSelectedWeekdays((prev) =>
            prev.includes(weekday)
                ? prev.filter((d) => d !== weekday)
                : [...prev, weekday]
        );
    };

    const handleRecurrenceChange = (type: RecurrenceType | null) => {
        setRecurrenceType(type);
        if (type !== 'weekdays') {
            setSelectedWeekdays([]);
        }
        if (type !== 'custom') {
            setCustomDays(null);
            setCustomUnit('days');
        }
    };

    const handleDelete = async (deleteOption?: 'this_only' | 'future_all') => {
        if (!taskIdParam) {
            alert('削除するタスクがありません');
            return;
        }

        const hasRecurrence = recurrenceType !== null;

        // 削除オプションが指定されていない場合、確認ダイアログを表示
        if (!deleteOption) {
            setShowDeleteDialog(true);
            return;
        }

        setDeleting(true);
        try {
            const payload: any = {};

            if (hasRecurrence) {
                payload.deleteOption = deleteOption;
                payload.targetDate = format(dueDate, 'yyyy-MM-dd');
            }

            const response = await fetch(`/api/tasks/${taskIdParam}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (response.ok) {
                // Optimistic UI: 削除成功後、即座にキャッシュを更新（現在日±1ヶ月の範囲の場合）
                if (userId) {
                    const taskDate = parseISO(format(dueDate, 'yyyy-MM-dd'));
                    if (isWithinCurrentMonthRange(taskDate)) {
                        if (hasRecurrence) {
                            // 繰り返しタスクの場合は全体をクリア（複数日に影響するため）
                            clearClientTasksCache(userId);
                        } else {
                            // 単発タスクの場合は、該当日のキャッシュを更新（削除されたタスクを除外）
                            try {
                                const dateStr = format(dueDate, 'yyyy-MM-dd');
                                const updatedTasksResponse = await fetch(`/api/tasks?date=${dateStr}`);
                                if (updatedTasksResponse.ok) {
                                    const updatedData = await updatedTasksResponse.json();
                                    if (updatedData.tasks) {
                                        // APIから取得したデータの日付をDateオブジェクトに変換
                                        const updatedTasksRaw: any[] = updatedData.tasks;
                                        const updatedTasks = updatedTasksRaw.map((task: any) => ({
                                            ...task,
                                            date: typeof task.date === 'string' ? parseISO(task.date) : new Date(task.date),
                                            due_date: typeof task.due_date === 'string' ? parseISO(task.due_date) : new Date(task.due_date),
                                            created_at: task.created_at ? (typeof task.created_at === 'string' ? parseISO(task.created_at) : new Date(task.created_at)) : undefined,
                                        }));
                                        
                                        // キャッシュを更新
                                        updateTasksCache(
                                            userId,
                                            { [dateStr]: updatedTasks },
                                            format(subMonths(taskDate, 1), 'yyyy-MM-dd'),
                                            format(addMonths(taskDate, 2), 'yyyy-MM-dd')
                                        );
                                    } else {
                                        // タスクが0件の場合もキャッシュを更新
                                        updateTasksCache(
                                            userId,
                                            { [dateStr]: [] },
                                            format(subMonths(taskDate, 1), 'yyyy-MM-dd'),
                                            format(addMonths(taskDate, 2), 'yyyy-MM-dd')
                                        );
                                    }
                                } else {
                                    // API取得に失敗した場合は該当日のキャッシュをクリア
                                    clearClientTasksCache(userId, dateStr);
                                }
                            } catch (cacheError) {
                                // キャッシュ更新のエラーは無視（次回アクセス時に再取得される）
                                console.warn('Failed to update cache after delete:', cacheError);
                                const dateStr = format(dueDate, 'yyyy-MM-dd');
                                clearClientTasksCache(userId, dateStr);
                            }
                        }
                    }
                }

                // 元のページに戻る（日付パラメータを保持）
                const returnDate = searchParams.get('date');
                const returnUrl = searchParams.get('returnUrl') || '/top';
                if (returnDate) {
                    router.push(`${returnUrl}?date=${returnDate}`);
                } else {
                    router.push(returnUrl);
                }
            } else {
                const error = await response.json();
                console.error('Delete error:', error);
                alert(error.error || '削除に失敗しました');
            }
        } catch (error) {
            console.error('Failed to delete task:', error);
            alert('削除に失敗しました');
        } finally {
            setDeleting(false);
            setShowDeleteDialog(false);
        }
    };

    // 認証前のみ全画面スピナー。認証後はフォームの骨組みを即表示し、編集時は中身を読み込み中表示
    if (!userId) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <span className="loading loading-spinner loading-lg"></span>
            </div>
        );
    }

    const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土'];

    // 時間形式の検出と変換候補の生成
    const detectTimePattern = (text: string): { pattern: string; converted: string; index: number } | null => {
        // パターン1: 「900」「1425」など（4桁の数字）
        let match = text.match(/\b(\d{4})\b/g);
        if (match) {
            const lastMatch = match[match.length - 1];
            const index = text.lastIndexOf(lastMatch);
            const hour = parseInt(lastMatch.substring(0, 2));
            const minute = parseInt(lastMatch.substring(2, 4));
            if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                // 無効化されたパターンでないか確認（位置に関係なく、パターン自体が無効化されていないかチェック）
                const patternKey = `${index}:${lastMatch}`;
                // 同じパターンが別の位置で無効化されていないかもチェック
                const isDismissed = Array.from(dismissedPatterns).some(key => key.endsWith(`:${lastMatch}`));
                if (!isDismissed && !dismissedPatterns.has(patternKey)) {
                    return {
                        pattern: lastMatch,
                        converted: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
                        index: index
                    };
                }
            }
        }

        // パターン2: 「900」「925」など（3桁の数字、時:分として解釈）
        match = text.match(/\b(\d{3})\b/g);
        if (match) {
            const lastMatch = match[match.length - 1];
            const index = text.lastIndexOf(lastMatch);
            const hour = parseInt(lastMatch.substring(0, 1));
            const minute = parseInt(lastMatch.substring(1, 3));
            if (hour >= 0 && hour <= 9 && minute >= 0 && minute <= 59) {
                // 無効化されたパターンでないか確認（位置に関係なく、パターン自体が無効化されていないかチェック）
                const patternKey = `${index}:${lastMatch}`;
                // 同じパターンが別の位置で無効化されていないかもチェック
                const isDismissed = Array.from(dismissedPatterns).some(key => key.endsWith(`:${lastMatch}`));
                if (!isDismissed && !dismissedPatterns.has(patternKey)) {
                    return {
                        pattern: lastMatch,
                        converted: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
                        index: index
                    };
                }
            }
        }

        // パターン3: 「9:00」など（既に正しい形式の場合は変換候補を出さない）
        match = text.match(/\b(\d{1,2}):(\d{2})\b/g);
        if (match) {
            // 既に正しい形式がある場合は変換候補を出さない
            return null;
        }

        return null;
    };

    const handleTitleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newTitle = e.target.value;
        const previousTitle = title;
        setTitle(newTitle);

        // 既存の候補がある場合の処理
        if (timeSuggestion) {
            const existingPattern = timeSuggestion.pattern;
            const existingIndex = timeSuggestion.index;
            const patternEndIndex = existingIndex + existingPattern.length;

            // テキストが短くなった場合は候補をクリア
            if (newTitle.length < patternEndIndex) {
                setTimeSuggestion(null);
                const suggestion = detectTimePattern(newTitle);
                setTimeSuggestion(suggestion);
                return;
            }

            // 既存のパターンが同じ位置に存在しない場合は候補をクリア
            const patternAtPosition = newTitle.substring(existingIndex, patternEndIndex);
            if (patternAtPosition !== existingPattern) {
                setTimeSuggestion(null);
                const suggestion = detectTimePattern(newTitle);
                setTimeSuggestion(suggestion);
                return;
            }

            // パターンの直後に追加の文字がある場合（スペースや他の文字が追加された場合）は候補を無効化
            // ただし、テキストが長くなっている場合のみ（削除の場合は除く）
            if (newTitle.length > previousTitle.length && newTitle.length > patternEndIndex) {
                const charAfterPattern = newTitle[patternEndIndex];
                // スペース、改行、または非数字文字が追加された場合は候補を無効化
                if (charAfterPattern && (charAfterPattern === ' ' || charAfterPattern === '\n' || !/\d/.test(charAfterPattern))) {
                    // このパターンを無効化リストに追加
                    const patternKey = `${existingIndex}:${existingPattern}`;
                    setDismissedPatterns(prev => new Set(prev).add(patternKey));
                    setTimeSuggestion(null);
                    // クリア後は新しいパターンを検出しない（ユーザーが別の入力に移ったため）
                    return;
                }
            }
        }

        // 時間パターンを検出
        const suggestion = detectTimePattern(newTitle);
        setTimeSuggestion(suggestion);
    };

    const handleTimeSuggestionClick = () => {
        if (timeSuggestion) {
            const before = title.substring(0, timeSuggestion.index);
            const after = title.substring(timeSuggestion.index + timeSuggestion.pattern.length);
            const newTitle = before + timeSuggestion.converted + ' ' + after;
            setTitle(newTitle);
            setTimeSuggestion(null);

            // フォーカスを維持し、カーソル位置を変換した時間の後（半角スペースの後）に移動
            setTimeout(() => {
                if (titleInputRef.current) {
                    const newCursorPosition = timeSuggestion.index + timeSuggestion.converted.length + 1;
                    titleInputRef.current.focus();
                    titleInputRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
                }
            }, 0);
        }
    };

    const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // 変換候補表示中にスペースまたはエンターを押したら候補を無効化（エンターの場合は改行を防ぐ）
        if ((e.key === ' ' || e.key === 'Enter') && timeSuggestion) {
            e.preventDefault();
            const patternKey = `${timeSuggestion.index}:${timeSuggestion.pattern}`;
            setDismissedPatterns(prev => new Set(prev).add(patternKey));
            setTimeSuggestion(null);
            if (e.key === 'Enter') {
                // エンターの場合は改行を手動で挿入
                const before = title.substring(0, timeSuggestion.index + timeSuggestion.pattern.length);
                const after = title.substring(timeSuggestion.index + timeSuggestion.pattern.length);
                setTitle(before + '\n' + after);
            }
        }
    };

    return (
        <div className="min-h-screen bg-base-200">
            {/* 専用ヘッダー */}
            <header className="bg-base-100 shadow-md sticky top-0 z-40">
                <div className="container mx-auto px-4 py-4 flex items-center justify-between">
                    <button
                        onClick={() => {
                            const returnDate = searchParams.get('date');
                            const returnUrl = searchParams.get('returnUrl') || '/top';
                            if (returnDate) {
                                router.push(`${returnUrl}?date=${returnDate}`);
                            } else {
                                router.back();
                            }
                        }}
                        className="btn btn-ghost btn-circle"
                    >
                        <span className="material-icons">arrow_back</span>
                    </button>
                    <h1 className="text-lg font-semibold">タスク編集</h1>
                    <div className="flex gap-2">
                        {taskIdParam && (
                            <button
                                onClick={() => handleDelete()}
                                className="btn btn-ghost btn-circle"
                                disabled={deleting || loading}
                            >
                                {deleting ? (
                                    <span className="loading loading-spinner loading-sm"></span>
                                ) : (
                                    <span className="material-icons text-error">delete</span>
                                )}
                            </button>
                        )}
                        <button
                            onClick={handleSave}
                            className="btn btn-ghost btn-circle"
                            disabled={saving || loading}
                        >
                            {saving ? (
                                <span className="loading loading-spinner loading-sm"></span>
                            ) : (
                                <span className="material-icons">save</span>
                            )}
                        </button>
                    </div>
                </div>
            </header>

            <div className="container mx-auto px-4 py-6 max-w-2xl">
                {loading && (
                    <div className="flex items-center gap-2 text-base-content/60 mb-4">
                        <span className="loading loading-spinner loading-sm"></span>
                        <span>読み込み中...</span>
                    </div>
                )}
                {/* タイトル入力 */}
                <div className="form-control mb-6">
                    <label className="label">
                        <span className="label-text font-semibold">タイトル</span>
                    </label>
                    <div className="relative">
                        <textarea
                            ref={titleInputRef}
                            placeholder={loading ? '読み込み中...' : 'タスクを入力（Enterで改行）'}
                            disabled={loading}
                            className="textarea textarea-bordered w-full min-h-24 resize-y"
                            rows={3}
                            value={title}
                            onChange={handleTitleChange}
                            onKeyDown={handleTitleKeyDown}
                            autoFocus={!loading && !!userId}
                        />
                        {timeSuggestion && (
                            <div className="absolute right-2 top-2">
                                <button
                                    type="button"
                                    onClick={handleTimeSuggestionClick}
                                    className="btn btn-sm btn-primary btn-outline"
                                >
                                    {timeSuggestion.converted}?
                                </button>
                            </div>
                        )}
                    </div>
                    <p className="text-sm text-base-content/60">
                        900や1425と入力すると9:00、14:25と変換できます
                    </p>
                </div>

                {/* 期日選択 */}
                <div className="form-control mb-6">
                    <label className="label">
                        <span className="label-text font-semibold">期日</span>
                    </label>
                    <button
                        type="button"
                        onClick={() => setShowDatePicker(true)}
                        className="btn btn-outline w-full justify-start"
                        disabled={loading}
                    >
                        {format(dueDate, 'yyyy年M月d日(E)', { locale: ja })}
                    </button>
                    {showDatePicker && (
                        <DatePicker
                            value={dueDate}
                            onChange={setDueDate}
                            onClose={() => setShowDatePicker(false)}
                        />
                    )}
                </div>

                {/* 通知設定 */}
                <div className="form-control mb-6">
                    <label className="label">
                        <span className="label-text font-semibold">通知設定</span>
                        <input
                            type="checkbox"
                            className="checkbox checkbox-primary"
                            checked={notificationEnabled}
                            onChange={(e) => setNotificationEnabled(e.target.checked)}
                        />
                    </label>
                    {notificationEnabled && (
                        <div>
                            <input
                                type="time"
                                className="input input-bordered mt-2"
                                value={notificationTime}
                                onChange={handleNotificationTimeChange}
                                onBlur={handleNotificationTimeBlur}
                                step="300"
                            />
                            <label className="label">
                                <span className="label-text-alt text-base-content/60">
                                    通知は5分刻みで送信されます（例: 13:00, 13:05, 13:10...）
                                </span>
                            </label>
                        </div>
                    )}
                </div>

                {/* 繰り返し設定 */}
                <div className="form-control mb-6">
                    <label className="label">
                        <span className="label-text font-semibold">繰り返し設定</span>
                    </label>

                    <div className="space-y-5">
                        <label className="label cursor-pointer justify-start py-3">
                            <input
                                type="checkbox"
                                className="checkbox checkbox-primary"
                                checked={recurrenceType === 'daily'}
                                onChange={() => handleRecurrenceChange(recurrenceType === 'daily' ? null : 'daily')}
                            />
                            <span className="label-text mr-4">毎日</span>
                        </label>

                        <label className="label cursor-pointer justify-start py-3">
                            <input
                                type="checkbox"
                                className="checkbox checkbox-primary"
                                checked={recurrenceType === 'weekly'}
                                onChange={() => handleRecurrenceChange(recurrenceType === 'weekly' ? null : 'weekly')}
                            />
                            <span className="label-text mr-4">毎週</span>
                        </label>

                        <label className="label cursor-pointer justify-start py-3">
                            <input
                                type="checkbox"
                                className="checkbox checkbox-primary"
                                checked={recurrenceType === 'monthly'}
                                onChange={() => handleRecurrenceChange(recurrenceType === 'monthly' ? null : 'monthly')}
                            />
                            <span className="label-text mr-4">毎月</span>
                        </label>

                        <label className="label cursor-pointer justify-start py-3">
                            <input
                                type="checkbox"
                                className="checkbox checkbox-primary"
                                checked={recurrenceType === 'monthly_end'}
                                onChange={() => handleRecurrenceChange(recurrenceType === 'monthly_end' ? null : 'monthly_end')}
                            />
                            <span className="label-text mr-4">毎月末</span>
                        </label>

                        <label className="label cursor-pointer justify-start py-3">
                            <input
                                type="checkbox"
                                className="checkbox checkbox-primary"
                                checked={recurrenceType === 'yearly'}
                                onChange={() => handleRecurrenceChange(recurrenceType === 'yearly' ? null : 'yearly')}
                            />
                            <span className="label-text">毎年</span>
                        </label>

                        <div className="mt-1">
                            <label className="label cursor-pointer justify-start py-3">
                                <input
                                    type="checkbox"
                                    className="checkbox checkbox-primary"
                                    checked={recurrenceType === 'weekdays'}
                                    onChange={() => handleRecurrenceChange(recurrenceType === 'weekdays' ? null : 'weekdays')}
                                />
                                <span className="label-text">指定曜日</span>
                            </label>
                            {recurrenceType === 'weekdays' && (
                                <div className="flex flex-wrap gap-2 ml-10 mt-2">
                                    {weekdayLabels.map((label, index) => (
                                        <button
                                            key={index}
                                            onClick={() => handleWeekdayToggle(index)}
                                            className={`btn btn-sm ${selectedWeekdays.includes(index)
                                                ? 'btn-primary'
                                                : 'btn-outline'
                                                }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="mt-1">
                            <label className="label cursor-pointer justify-start py-3">
                                <input
                                    type="checkbox"
                                    className="checkbox checkbox-primary"
                                    checked={recurrenceType === 'custom'}
                                    onChange={() => handleRecurrenceChange(recurrenceType === 'custom' ? null : 'custom')}
                                />
                                <span className="label-text">カスタム期間</span>
                            </label>
                            {recurrenceType === 'custom' && (
                                <div className="ml-10 mt-2 space-y-3">
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="radio"
                                            name="customUnit"
                                            className="radio radio-primary"
                                            checked={customUnit === 'days'}
                                            onChange={() => setCustomUnit('days')}
                                        />
                                        <input
                                            type="number"
                                            min="1"
                                            placeholder="日数"
                                            className="input input-bordered w-20"
                                            value={customUnit === 'days' ? (customDays || '') : ''}
                                            onChange={(e) => {
                                                if (customUnit === 'days') {
                                                    setCustomDays(e.target.value ? parseInt(e.target.value) : null);
                                                }
                                            }}
                                            disabled={customUnit !== 'days'}
                                        />
                                        <span>日おき</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="radio"
                                            name="customUnit"
                                            className="radio radio-primary"
                                            checked={customUnit === 'weeks'}
                                            onChange={() => setCustomUnit('weeks')}
                                        />
                                        <input
                                            type="number"
                                            min="1"
                                            placeholder="週数"
                                            className="input input-bordered w-20"
                                            value={customUnit === 'weeks' ? (customDays || '') : ''}
                                            onChange={(e) => {
                                                if (customUnit === 'weeks') {
                                                    setCustomDays(e.target.value ? parseInt(e.target.value) : null);
                                                }
                                            }}
                                            disabled={customUnit !== 'weeks'}
                                        />
                                        <span>週おき</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="radio"
                                            name="customUnit"
                                            className="radio radio-primary"
                                            checked={customUnit === 'months'}
                                            onChange={() => setCustomUnit('months')}
                                        />
                                        <input
                                            type="number"
                                            min="1"
                                            placeholder="月数"
                                            className="input input-bordered w-20"
                                            value={customUnit === 'months' ? (customDays || '') : ''}
                                            onChange={(e) => {
                                                if (customUnit === 'months') {
                                                    setCustomDays(e.target.value ? parseInt(e.target.value) : null);
                                                }
                                            }}
                                            disabled={customUnit !== 'months'}
                                        />
                                        <span>ヵ月おき</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="radio"
                                            name="customUnit"
                                            className="radio radio-primary"
                                            checked={customUnit === 'months_end'}
                                            onChange={() => setCustomUnit('months_end')}
                                        />
                                        <input
                                            type="number"
                                            min="1"
                                            placeholder="月数"
                                            className="input input-bordered w-20"
                                            value={customUnit === 'months_end' ? (customDays || '') : ''}
                                            onChange={(e) => {
                                                if (customUnit === 'months_end') {
                                                    setCustomDays(e.target.value ? parseInt(e.target.value) : null);
                                                }
                                            }}
                                            disabled={customUnit !== 'months_end'}
                                        />
                                        <span>ヵ月おきの月末</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="radio"
                                            name="customUnit"
                                            className="radio radio-primary"
                                            checked={customUnit === 'years'}
                                            onChange={() => setCustomUnit('years')}
                                        />
                                        <input
                                            type="number"
                                            min="1"
                                            placeholder="年数"
                                            className="input input-bordered w-20"
                                            value={customUnit === 'years' ? (customDays || '') : ''}
                                            onChange={(e) => {
                                                if (customUnit === 'years') {
                                                    setCustomDays(e.target.value ? parseInt(e.target.value) : null);
                                                }
                                            }}
                                            disabled={customUnit !== 'years'}
                                        />
                                        <span>年おき</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* 保存スコープ選択ダイアログ（繰り返し予定の編集時） */}
            {showSaveScopeDialog && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-hidden p-4">
                    <div className="bg-base-100 rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
                        <h2 className="text-xl font-bold mb-4">変更の適用範囲</h2>
                        <p className="mb-6">この予定は繰り返し設定が有効です。変更をどこに適用しますか？</p>

                        <div className="space-y-3 mb-6">
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input
                                    type="radio"
                                    name="saveScope"
                                    value="this_only"
                                    defaultChecked
                                    className="radio radio-primary"
                                />
                                <span>この予定のみ変更</span>
                            </label>
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input
                                    type="radio"
                                    name="saveScope"
                                    value="all_future"
                                    className="radio radio-primary"
                                />
                                <span>これ以降のすべての繰り返し予定も変更</span>
                            </label>
                        </div>

                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setShowSaveScopeDialog(false)}
                                className="btn btn-ghost"
                                disabled={saving}
                            >
                                キャンセル
                            </button>
                            <button
                                onClick={() => {
                                    const selected = document.querySelector('input[name="saveScope"]:checked') as HTMLInputElement;
                                    if (selected) {
                                        performSave(selected.value as 'this_only' | 'all_future');
                                    }
                                }}
                                className="btn btn-primary"
                                disabled={saving}
                            >
                                {saving ? (
                                    <>
                                        <span className="loading loading-spinner loading-sm"></span>
                                        保存中...
                                    </>
                                ) : (
                                    '保存'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 削除確認ダイアログ */}
            {showDeleteDialog && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-hidden p-4">
                    <div className="bg-base-100 rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
                        <h2 className="text-xl font-bold mb-4">タスクの削除</h2>
                        {recurrenceType !== null ? (
                            <>
                                <p className="mb-6">このタスクは繰り返し設定が有効です。削除方法を選択してください。</p>

                                <div className="space-y-3 mb-6">
                                    <label className="flex items-center gap-3 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="deleteOption"
                                            value="this_only"
                                            defaultChecked
                                            className="radio radio-primary"
                                        />
                                        <span>このタスクのみ削除</span>
                                    </label>
                                    <label className="flex items-center gap-3 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="deleteOption"
                                            value="future_all"
                                            className="radio radio-primary"
                                        />
                                        <span>これ以降の繰り返しタスクすべてを削除</span>
                                    </label>
                                </div>

                                <div className="flex justify-end gap-3">
                                    <button
                                        onClick={() => {
                                            setShowDeleteDialog(false);
                                        }}
                                        className="btn btn-ghost"
                                        disabled={deleting}
                                    >
                                        キャンセル
                                    </button>
                                    <button
                                        onClick={() => {
                                            const selectedOption = document.querySelector('input[name="deleteOption"]:checked') as HTMLInputElement;
                                            if (selectedOption) {
                                                handleDelete(selectedOption.value as 'this_only' | 'future_all');
                                            }
                                        }}
                                        className="btn btn-error"
                                        disabled={deleting}
                                    >
                                        {deleting ? (
                                            <>
                                                <span className="loading loading-spinner loading-sm"></span>
                                                削除中...
                                            </>
                                        ) : (
                                            '削除'
                                        )}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <p className="mb-6">このタスクを削除してもよろしいですか？</p>

                                <div className="flex justify-end gap-3">
                                    <button
                                        onClick={() => {
                                            setShowDeleteDialog(false);
                                        }}
                                        className="btn btn-ghost"
                                        disabled={deleting}
                                    >
                                        キャンセル
                                    </button>
                                    <button
                                        onClick={() => {
                                            handleDelete('this_only'); // 繰り返しがない場合は'this_only'でOK
                                        }}
                                        className="btn btn-error"
                                        disabled={deleting}
                                    >
                                        {deleting ? (
                                            <>
                                                <span className="loading loading-spinner loading-sm"></span>
                                                削除中...
                                            </>
                                        ) : (
                                            '削除'
                                        )}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default function TaskEditPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center">
                <span className="loading loading-spinner loading-lg"></span>
            </div>
        }>
            <TaskEditPageContent />
        </Suspense>
    );
}