'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import DatePicker from '@/components/DatePicker';
import { RecurrenceType } from '@/types/database';

export default function TaskEditPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [userId, setUserId] = useState<string | null>(null);

    // URLパラメータから取得
    const taskIdParam = searchParams.get('taskId');
    const dateParam = searchParams.get('date');
    const initialDate = dateParam ? parseISO(dateParam) : new Date();

    // フォーム状態
    const [title, setTitle] = useState('');
    const [dueDate, setDueDate] = useState(initialDate);
    const [notificationEnabled, setNotificationEnabled] = useState(false);
    const [notificationTime, setNotificationTime] = useState('');
    const [recurrenceType, setRecurrenceType] = useState<RecurrenceType | null>(null);
    const [customDays, setCustomDays] = useState<number | null>(null);
    const [customUnit, setCustomUnit] = useState<'days' | 'weeks' | 'months' | 'years'>('days');
    const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([]);

    const [showDatePicker, setShowDatePicker] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
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

            // 既存タスクを編集する場合
            if (taskIdParam) {
                // URLパラメータの日付がある場合は、読み込み後に期日を更新する可能性がある
                const dateParam = searchParams.get('date');
                loadTask(taskIdParam, user.id, dateParam);
            } else {
                // 新規タスク作成時は、URLパラメータの日付を使用
                const newDateParam = searchParams.get('date');
                if (newDateParam) {
                    try {
                        const parsedDate = parseISO(newDateParam);
                        setDueDate(parsedDate);
                    } catch (e) {
                        // パースエラーは無視
                    }
                }
            }
        };

        checkAuth();
    }, [router, taskIdParam, searchParams]);

    const loadTask = async (taskId: string, userId: string, dateParam?: string | null) => {
        setLoading(true);
        try {
            console.log('Loading task:', taskId);
            const response = await fetch(`/api/tasks/${taskId}`);
            console.log('Task response status:', response.status);
            
            if (response.ok) {
                const data = await response.json();
                console.log('Task data loaded:', data);
                
                if (!data.task) {
                    console.error('Task data not found in response:', data);
                    alert('タスクデータが見つかりませんでした');
                    router.back();
                    return;
                }
                setTitle(data.task.title || '');
                
                // 期日の設定: URLパラメータの日付がある場合はそれを使用、なければタスクの期日を使用
                if (dateParam) {
                    try {
                        const parsedDate = parseISO(dateParam);
                        setDueDate(parsedDate);
                    } catch (e) {
                        // パースエラーはタスクの期日を使用
                        setDueDate(data.task.due_date ? new Date(data.task.due_date) : initialDate);
                    }
                } else {
                    setDueDate(data.task.due_date ? new Date(data.task.due_date) : initialDate);
                }
                
                setNotificationEnabled(data.task.notification_enabled || false);
                setNotificationTime(data.task.notification_time || '');

                if (data.recurrence) {
                    setRecurrenceType(data.recurrence.type);
                    
                    // カスタム期間の場合、単位情報から復元
                    if (data.recurrence.type === 'custom' && data.recurrence.custom_days) {
                        if (data.recurrence.custom_unit) {
                            // 単位情報がある場合はそれを使用
                            setCustomUnit(data.recurrence.custom_unit as 'days' | 'weeks' | 'months' | 'years');
                            setCustomDays(data.recurrence.custom_days);
                        } else {
                            // 単位情報がない場合は推測（後方互換性）
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
                        // カスタム期間以外の場合
                        setCustomDays(data.recurrence.custom_days || null);
                    }

                    setSelectedWeekdays(data.recurrence.weekdays || []);
                } else {
                    // 繰り返し設定がない場合、すべてリセット
                    setRecurrenceType(null);
                    setCustomDays(null);
                    setCustomUnit('days');
                    setSelectedWeekdays([]);
                }
            } else {
                const errorData = await response.json();
                console.error('Failed to load task:', response.status, errorData);
                if (response.status === 404) {
                    alert('タスクが見つかりませんでした。既に削除されている可能性があります。');
                    router.back();
                } else {
                    alert(`タスクの読み込みに失敗しました: ${errorData.error || 'Unknown error'}`);
                }
            }
        } catch (error) {
            console.error('Failed to load task:', error);
            alert('タスクの読み込み中にエラーが発生しました');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!title.trim() || !userId) {
            alert('タイトルを入力してください');
            return;
        }

        setSaving(true);
        try {
            // カスタム期間の場合、日数と単位を保存
            let customDaysToSave = null;
            let customUnitToSave = null;
            if (recurrenceType === 'custom' && customDays) {
                customDaysToSave = customDays;
                customUnitToSave = customUnit;
                // 日単位の場合は単位を保存しない（後方互換性）
                if (customUnit === 'days') {
                    customUnitToSave = null;
                }
            }

            const payload = {
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

            const response = await fetch('/api/tasks', {
                method: taskIdParam ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (response.ok) {
                // 元のページに戻る
                const returnUrl = searchParams.get('returnUrl') || '/top';
                router.push(returnUrl);
            } else {
                const error = await response.json();
                console.error('Save error:', error);
                alert(error.error || '保存に失敗しました。データベーススキーマが最新か確認してください。');
            }
        } catch (error) {
            console.error('Failed to save task:', error);
            alert('保存に失敗しました');
        } finally {
            setSaving(false);
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

    if (!userId || loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <span className="loading loading-spinner loading-lg"></span>
            </div>
        );
    }

    const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土'];

    return (
        <div className="min-h-screen bg-base-200">
            {/* 専用ヘッダー */}
            <header className="bg-base-100 shadow-md sticky top-0 z-40">
                <div className="container mx-auto px-4 py-4 flex items-center justify-between">
                    <button
                        onClick={() => router.back()}
                        className="btn btn-ghost btn-circle"
                    >
                        <span className="material-icons">arrow_back</span>
                    </button>
                    <h1 className="text-lg font-semibold">タスク編集</h1>
                    <button
                        onClick={handleSave}
                        className="btn btn-ghost btn-circle"
                        disabled={saving}
                    >
                        {saving ? (
                            <span className="loading loading-spinner loading-sm"></span>
                        ) : (
                            <span className="material-icons">save</span>
                        )}
                    </button>
                </div>
            </header>

            <div className="container mx-auto px-4 py-6 max-w-2xl">
                {/* タイトル入力 */}
                <div className="form-control mb-6">
                    <label className="label">
                        <span className="label-text font-semibold">タイトル</span>
                    </label>
                    <input
                        type="text"
                        placeholder="タスクを入力"
                        className="input input-bordered w-full"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                    />
                </div>

                {/* 期日選択 */}
                <div className="form-control mb-6">
                    <label className="label">
                        <span className="label-text font-semibold">期日</span>
                    </label>
                    <button
                        onClick={() => setShowDatePicker(true)}
                        className="btn btn-outline w-full justify-start"
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
                        <input
                            type="time"
                            className="input input-bordered mt-2"
                            value={notificationTime}
                            onChange={(e) => setNotificationTime(e.target.value)}
                        />
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
        </div>
    );
}

