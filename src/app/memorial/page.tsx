'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import DatePicker from '@/components/DatePicker';

function MemorialEditPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [userId, setUserId] = useState<string | null>(null);

    // URLパラメータから取得
    const memorialIdParam = searchParams.get('memorialId');
    const dateParam = searchParams.get('date');
    const initialDate = dateParam ? parseISO(dateParam) : new Date();

    // フォーム状態
    const [title, setTitle] = useState('');
    const [timeSuggestion, setTimeSuggestion] = useState<{ pattern: string; converted: string; index: number } | null>(null);
    const titleInputRef = useRef<HTMLInputElement>(null);
    const [dueDate, setDueDate] = useState(initialDate);
    const [notificationEnabled, setNotificationEnabled] = useState(false);
    const [notificationTime, setNotificationTime] = useState('');
    const [yearlyEnabled, setYearlyEnabled] = useState(false);

    const [showDatePicker, setShowDatePicker] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [memorialList, setMemorialList] = useState<Array<{ id: string; title: string; due_date: Date; recurrence_type: string | null }>>([]);
    const [loadingMemorialList, setLoadingMemorialList] = useState(false);

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

            // 既存記念日を編集する場合
            if (memorialIdParam) {
                // URLパラメータの日付がある場合は、読み込み後に期日を更新する可能性がある
                const dateParam = searchParams.get('date');
                loadMemorial(memorialIdParam, user.id, dateParam);
            } else {
                // 新規記念日作成時は、URLパラメータの日付を使用
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
    }, [router, memorialIdParam, searchParams]);

    useEffect(() => {
        if (userId) {
            loadMemorialList();
        }
    }, [userId]);

    const loadMemorial = async (memorialId: string, userId: string, dateParam?: string | null) => {
        setLoading(true);
        try {
            console.log('Loading memorial:', memorialId);
            const response = await fetch(`/api/memorials/${memorialId}`);
            console.log('Memorial response status:', response.status);

            if (response.ok) {
                const data = await response.json();
                console.log('Memorial data loaded:', data);

                if (!data.memorial) {
                    console.error('Memorial data not found in response:', data);
                    alert('記念日データが見つかりませんでした');
                    router.back();
                    return;
                }
                setTitle(data.memorial.title || '');

                // 期日の設定: URLパラメータの日付がある場合はそれを使用、なければ記念日の期日を使用
                if (dateParam) {
                    try {
                        const parsedDate = parseISO(dateParam);
                        setDueDate(parsedDate);
                    } catch (e) {
                        // パースエラーは記念日の期日を使用
                        setDueDate(data.memorial.due_date ? new Date(data.memorial.due_date) : initialDate);
                    }
                } else {
                    setDueDate(data.memorial.due_date ? new Date(data.memorial.due_date) : initialDate);
                }

                setNotificationEnabled(data.memorial.notification_enabled || false);
                setNotificationTime(data.memorial.notification_time || '');

                // 繰り返し設定がyearlyの場合のみ、毎年設定を有効にする
                setYearlyEnabled(data.memorial.recurrence?.type === 'yearly' || false);
            } else {
                const errorData = await response.json();
                console.error('Failed to load memorial:', response.status, errorData);
                if (response.status === 404) {
                    alert('記念日が見つかりませんでした。既に削除されている可能性があります。');
                    router.back();
                } else {
                    alert(`記念日の読み込みに失敗しました: ${errorData.error || 'Unknown error'}`);
                }
            }
        } catch (error) {
            console.error('Failed to load memorial:', error);
            alert('記念日の読み込み中にエラーが発生しました');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!title.trim() || !userId) {
            alert('タイトルを入力してください');
            return;
        }

        // 通知設定が有効な場合、メールアドレスまたはWeb Push設定の確認
        if (notificationEnabled && notificationTime) {
            try {
                const settingsResponse = await fetch('/api/settings/notifications');
                if (settingsResponse.ok) {
                    const settingsData = await settingsResponse.json();
                    const hasEmail = settingsData.settings?.email && settingsData.settings?.email_notification_enabled;
                    const hasWebPush = settingsData.settings?.web_push_enabled;

                    // メール通知もWeb Push通知も有効でない場合、通知設定ページへ遷移
                    if (!hasEmail && !hasWebPush) {
                        const returnDate = searchParams.get('date');
                        const returnUrl = `/memorial${memorialIdParam ? `?memorialId=${memorialIdParam}` : ''}${returnDate ? `&date=${returnDate}` : ''}`;
                        const confirmed = confirm(
                            '通知を送信するには、メールアドレスまたはWeb Push通知の設定が必要です。\n通知設定ページに移動しますか？'
                        );
                        if (confirmed) {
                            router.push(`/settings/notifications?returnUrl=${encodeURIComponent(returnUrl)}`);
                            return;
                        } else {
                            return; // ユーザーがキャンセルした場合は保存しない
                        }
                    }
                }
            } catch (error) {
                console.error('Failed to check notification settings:', error);
                // エラーが発生しても保存は続行（通知が送信されない可能性があるが、タスク自体は保存される）
            }
        }

        setSaving(true);
        try {
            const payload = {
                memorialId: memorialIdParam,
                title: title.trim(),
                dueDate: format(dueDate, 'yyyy-MM-dd'),
                notificationEnabled,
                notificationTime: notificationEnabled ? notificationTime : null,
                yearlyEnabled,
            };

            const response = await fetch('/api/memorials', {
                method: memorialIdParam ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (response.ok) {
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
                console.error('Save error:', error);
                alert(error.error || '保存に失敗しました。データベーススキーマが最新か確認してください。');
            }
        } catch (error) {
            console.error('Failed to save memorial:', error);
            alert('保存に失敗しました');
        } finally {
            setSaving(false);
        }
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


    const loadMemorialList = async () => {
        if (!userId) return;
        setLoadingMemorialList(true);
        try {
            const response = await fetch('/api/memorials');
            if (response.ok) {
                const data = await response.json();
                setMemorialList(data.memorials || []);
            }
        } catch (error) {
            console.error('Failed to load memorial list:', error);
        } finally {
            setLoadingMemorialList(false);
        }
    };

    const handleDelete = async (memorialId: string) => {
        if (!confirm('この記念日を削除してもよろしいですか？')) {
            return;
        }

        setDeleting(true);
        try {
            const response = await fetch(`/api/memorials/${memorialId}`, {
                method: 'DELETE',
            });

            if (response.ok) {
                // リストを更新
                loadMemorialList();
                // 編集ページから削除した場合は、編集ページを閉じる
                if (memorialId === memorialIdParam) {
                    router.push('/memorial');
                }
            } else {
                const error = await response.json();
                console.error('Delete error:', error);
                alert(error.error || '削除に失敗しました');
            }
        } catch (error) {
            console.error('Failed to delete memorial:', error);
            alert('削除に失敗しました');
        } finally {
            setDeleting(false);
        }
    };

    if (!userId || loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <span className="loading loading-spinner loading-lg"></span>
            </div>
        );
    }

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
                return {
                    pattern: lastMatch,
                    converted: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
                    index: index
                };
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
                return {
                    pattern: lastMatch,
                    converted: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
                    index: index
                };
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

    const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newTitle = e.target.value;
        setTitle(newTitle);

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

    const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        // スペースやエンターを押したら変換候補をクリア
        if (e.key === ' ' || e.key === 'Enter') {
            setTimeSuggestion(null);
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
                    <h1 className="text-lg font-semibold">記念日設定</h1>
                    <div className="flex gap-2">
                        {memorialIdParam && (
                            <button
                                onClick={() => handleDelete(memorialIdParam)}
                                className="btn btn-ghost btn-circle"
                                disabled={deleting}
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
                            disabled={saving}
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
                {/* タイトル入力 */}
                <div className="form-control mb-6">
                    <label className="label">
                        <span className="label-text font-semibold">タイトル</span>
                    </label>
                    <div className="relative">
                        <input
                            ref={titleInputRef}
                            type="text"
                            placeholder="記念日を入力"
                            className="input input-bordered w-full"
                            value={title}
                            onChange={handleTitleChange}
                            onKeyDown={handleTitleKeyDown}
                        />
                        {timeSuggestion && (
                            <div className="absolute right-2 top-1/2 -translate-y-1/2">
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

                {/* 毎年設定 */}
                <div className="form-control mb-6">
                    <label className="label cursor-pointer justify-start">
                        <span className="label-text font-semibold">毎年設定する</span>
                        <input
                            type="checkbox"
                            className="checkbox checkbox-primary"
                            checked={yearlyEnabled}
                            onChange={(e) => setYearlyEnabled(e.target.checked)}
                        />
                    </label>
                </div>

                {/* 登録済みの記念日 */}
                {!memorialIdParam && (
                    <div className="form-control mb-6">
                        <label className="label">
                            <span className="label-text font-semibold">登録済みの記念日</span>
                        </label>
                        {loadingMemorialList ? (
                            <div className="flex justify-center py-4">
                                <span className="loading loading-spinner"></span>
                            </div>
                        ) : memorialList.length === 0 ? (
                            <div className="text-center text-base-content/50 py-4">
                                登録済みの記念日はありません
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {memorialList.map((memorial) => (
                                    <div key={memorial.id} className="flex items-center justify-between p-3 bg-base-100 rounded-lg shadow hover:shadow-md transition-shadow">
                                        <button
                                            onClick={() => router.push(`/memorial?memorialId=${memorial.id}`)}
                                            className="flex-1 text-left"
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm text-base-content/60">
                                                    {memorial.recurrence_type === 'yearly'
                                                        ? format(memorial.due_date, 'M月d日', { locale: ja })
                                                        : format(memorial.due_date, 'yyyy年M月d日', { locale: ja })}
                                                </span>
                                                <span>{memorial.title}</span>
                                                {memorial.recurrence_type && (
                                                    <span className="badge badge-sm badge-outline">毎年</span>
                                                )}
                                            </div>
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDelete(memorial.id);
                                            }}
                                            className="btn btn-ghost btn-sm btn-circle"
                                            disabled={deleting}
                                        >
                                            <span className="material-icons text-error text-lg">delete</span>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default function MemorialEditPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center">
                <span className="loading loading-spinner loading-lg"></span>
            </div>
        }>
            <MemorialEditPageContent />
        </Suspense>
    );
}