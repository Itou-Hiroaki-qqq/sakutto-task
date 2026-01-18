'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { createClient } from '@/lib/supabase/client';

interface ExtractedEvent {
    date: string; // 'YYYY-MM-DD'
    title: string;
    description?: string;
    type?: string; // '全校', '2年', '会議', 'イベント' など
    keyword: string; // 予定表のキーワード
}

export default function EventCalendarPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    const [files, setFiles] = useState<File[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [extractedEvents, setExtractedEvents] = useState<ExtractedEvent[]>([]);
    const [selectedEventIndices, setSelectedEventIndices] = useState<Set<number>>(new Set());
    const [saving, setSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [savedCount, setSavedCount] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [genreName, setGenreName] = useState<string>('');
    const [newEventDate, setNewEventDate] = useState<string>('');
    const [newEventTitle, setNewEventTitle] = useState<string>('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dropZoneRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        checkAuth();
    }, []);

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

    const handleFileSelect = (selectedFiles: FileList | null) => {
        if (!selectedFiles) return;

        const validFiles: File[] = [];
        for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];
            
            // ファイル形式チェック
            if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
                setError(`${file.name} は画像またはPDFファイルではありません`);
                continue;
            }

            // ファイルサイズチェック（10MB制限）
            if (file.size > 10 * 1024 * 1024) {
                setError(`${file.name} は10MBを超えています`);
                continue;
            }

            validFiles.push(file);
        }

        // 最大2枚まで
        const newFiles = [...files, ...validFiles].slice(0, 2);
        setFiles(newFiles);
        setError(null);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        handleFileSelect(e.dataTransfer.files);
    };

    const removeFile = (index: number) => {
        setFiles(files.filter((_, i) => i !== index));
    };

    const handleProcess = async () => {
        if (files.length === 0) {
            setError('ファイルを選択してください');
            return;
        }

        if (!userId) {
            setError('ユーザー認証が必要です');
            return;
        }

        setProcessing(true);
        setError(null);
        setExtractedEvents([]);

        try {
            const formData = new FormData();
            files.forEach((file) => {
                formData.append('files', file);
            });

            const response = await fetch('/api/event-calendar/upload', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'ファイルの処理に失敗しました');
            }

            const data = await response.json();
            const events = data.events || [];
            setExtractedEvents(events);
            // デフォルトで全て選択
            setSelectedEventIndices(new Set(events.map((_: any, index: number) => index)));
            setSaveSuccess(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'ファイルの処理に失敗しました');
        } finally {
            setProcessing(false);
        }
    };

    const toggleEventSelection = (index: number) => {
        const newSelected = new Set(selectedEventIndices);
        if (newSelected.has(index)) {
            newSelected.delete(index);
        } else {
            newSelected.add(index);
        }
        setSelectedEventIndices(newSelected);
    };

    const toggleAllEvents = () => {
        if (selectedEventIndices.size === extractedEvents.length) {
            setSelectedEventIndices(new Set());
        } else {
            setSelectedEventIndices(new Set(extractedEvents.map((_, index) => index)));
        }
    };

    const handleEventDateChange = (index: number, newDate: string) => {
        const updatedEvents = [...extractedEvents];
        updatedEvents[index] = { ...updatedEvents[index], date: newDate };
        setExtractedEvents(updatedEvents);
    };

    const handleEventTitleChange = (index: number, newTitle: string) => {
        const updatedEvents = [...extractedEvents];
        updatedEvents[index] = { ...updatedEvents[index], title: newTitle };
        setExtractedEvents(updatedEvents);
    };

    const handleAddNewEvent = () => {
        if (!newEventDate || !newEventTitle.trim()) {
            setError('日付とイベントタイトルを入力してください');
            return;
        }

        // 日付形式の検証（YYYY-MM-DD）
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(newEventDate)) {
            setError('日付はYYYY-MM-DD形式で入力してください');
            return;
        }

        const newEvent: ExtractedEvent = {
            date: newEventDate,
            title: newEventTitle.trim(),
            keyword: '',
        };

        setExtractedEvents([...extractedEvents, newEvent]);
        setNewEventDate('');
        setNewEventTitle('');
        setError(null);
    };

    const handleSortByDate = () => {
        const sortedEvents = [...extractedEvents].sort((a, b) => {
            return a.date.localeCompare(b.date);
        });
        setExtractedEvents(sortedEvents);
    };

    const handleDeleteEvent = (index: number) => {
        const updatedEvents = extractedEvents.filter((_, i) => i !== index);
        setExtractedEvents(updatedEvents);
        // 選択状態も更新
        const newSelected = new Set(selectedEventIndices);
        newSelected.delete(index);
        // インデックスを再調整
        const adjustedSelected = new Set<number>();
        selectedEventIndices.forEach((selectedIndex) => {
            if (selectedIndex < index) {
                adjustedSelected.add(selectedIndex);
            } else if (selectedIndex > index) {
                adjustedSelected.add(selectedIndex - 1);
            }
        });
        setSelectedEventIndices(adjustedSelected);
    };

    const handleSaveAsTasks = async () => {
        if (selectedEventIndices.size === 0) {
            setError('保存するイベントを選択してください');
            return;
        }

        if (!userId) {
            setError('ユーザー認証が必要です');
            return;
        }

        setSaving(true);
        setError(null);
        setSaveSuccess(false);

        try {
            const selectedEvents = Array.from(selectedEventIndices).map(
                (index) => extractedEvents[index]
            );

            // 各イベントをタスクとして保存
            const savePromises = selectedEvents.map((event) => {
                // ジャンル名が入力されている場合は「ジャンル名：イベントタイトル」の形式にする
                const title = genreName.trim() 
                    ? `${genreName.trim()}：${event.title}` 
                    : event.title;
                
                return fetch('/api/tasks', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        title: title,
                        dueDate: event.date,
                        notificationEnabled: false,
                    }),
                });
            });

            const results = await Promise.allSettled(savePromises);

            // エラーをチェック
            const errors = results
                .map((result, index) => {
                    if (result.status === 'rejected') {
                        return `イベント「${selectedEvents[index].title}」の保存に失敗しました: ${result.reason}`;
                    }
                    if (!result.value.ok) {
                        return `イベント「${selectedEvents[index].title}」の保存に失敗しました`;
                    }
                    return null;
                })
                .filter((error) => error !== null);

            if (errors.length > 0) {
                setError(errors.join('\n'));
            } else {
                setSaveSuccess(true);
                setSavedCount(selectedEvents.length);
                // 保存に成功したイベントを選択解除
                setSelectedEventIndices(new Set());
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'タスクの保存に失敗しました');
        } finally {
            setSaving(false);
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
        <Layout>
            <div className="container mx-auto px-4 py-6 max-w-4xl">
                <button
                    onClick={() => router.push('/top')}
                    className="text-sm text-base-content/70 hover:text-base-content mb-2 flex items-center gap-1"
                >
                    ← 戻る
                </button>
                <h1 className="text-3xl font-bold mb-6">予定表の読み込み</h1>

                {/* エラーメッセージ */}
                {error && (
                    <div className="alert alert-error mb-6">
                        <span className="whitespace-pre-line">{error}</span>
                    </div>
                )}

                {/* ファイルアップロードエリア */}
                <div className="card bg-base-100 shadow-xl mb-6">
                    <div className="card-body">
                        <h2 className="card-title text-xl mb-4">ファイルを選択</h2>
                        <p className="text-sm text-base-content/70 mb-4">
                            予定表の画像（JPG/PNG）またはPDFファイルをアップロードしてください（最大2枚まで）
                        </p>

                        {/* ドラッグ&ドロップエリア */}
                        <div
                            ref={dropZoneRef}
                            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                                isDragging
                                    ? 'border-primary bg-primary/10'
                                    : 'border-base-300 hover:border-primary/50'
                            }`}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*,application/pdf"
                                multiple
                                className="hidden"
                                onChange={(e) => handleFileSelect(e.target.files)}
                            />
                            <div className="space-y-2">
                                <p className="text-lg">ファイルをドラッグ&ドロップ</p>
                                <p className="text-sm text-base-content/60">または</p>
                                <button
                                    className="btn btn-primary"
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    ファイルを選択
                                </button>
                            </div>
                        </div>

                        {/* 選択されたファイル一覧 */}
                        {files.length > 0 && (
                            <div className="mt-4 space-y-2">
                                <h3 className="font-semibold">選択されたファイル:</h3>
                                {files.map((file, index) => (
                                    <div
                                        key={index}
                                        className="flex items-center justify-between p-3 bg-base-200 rounded-lg"
                                    >
                                        <div className="flex-1">
                                            <p className="font-medium">{file.name}</p>
                                            <p className="text-sm text-base-content/60">
                                                {(file.size / 1024 / 1024).toFixed(2)} MB
                                            </p>
                                        </div>
                                        <button
                                            className="btn btn-sm btn-ghost"
                                            onClick={() => removeFile(index)}
                                        >
                                            削除
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* 処理ボタン */}
                        <div className="mt-6">
                            <button
                                className="btn btn-primary w-full"
                                onClick={handleProcess}
                                disabled={files.length === 0 || processing}
                            >
                                {processing ? (
                                    <>
                                        <span className="loading loading-spinner loading-sm"></span>
                                        処理中...
                                    </>
                                ) : (
                                    '予定表を解析'
                                )}
                            </button>
                            {processing && (
                                <p className="mt-3 text-sm text-center text-base-content/70">
                                    AIにより解析しています。数分かかることがあります。
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                {/* 成功メッセージ */}
                {saveSuccess && (
                    <div className="alert alert-success mb-6">
                        <div className="flex flex-col gap-2">
                            <span>各日のタスクに追加しました</span>
                            <div className="flex gap-2">
                                <button
                                    className="btn btn-sm btn-neutral"
                                    onClick={() => {
                                        setSaveSuccess(false);
                                        setExtractedEvents([]);
                                        setFiles([]);
                                    }}
                                >
                                    新しい予定表を読み込む
                                </button>
                                <button
                                    className="btn btn-sm btn-primary"
                                    onClick={() => router.push('/top')}
                                >
                                    タスク一覧を確認
                                </button>
                            </div>
                            <p className="text-sm text-base-content/70">※どちらの場合もページ遷移するため読み込んだファイル情報は消えます</p>
                        </div>
                    </div>
                )}

                {/* 抽出結果表示エリア */}
                {extractedEvents.length > 0 && (
                    <div className="card bg-base-100 shadow-xl">
                        <div className="card-body">
                            {/* ジャンル名入力欄 */}
                            <div className="mb-6">
                                <label className="block text-sm font-medium mb-2">
                                    イベントの冒頭にジャンル名をつける場合は入力
                                </label>
                                <input
                                    type="text"
                                    value={genreName}
                                    onChange={(e) => setGenreName(e.target.value)}
                                    placeholder="例: 会社"
                                    className="input input-bordered w-full max-w-xs"
                                />
                                <p className="text-sm text-base-content/70 mt-2">
                                    ジャンル名を「会社」とすると、タスクに「会社：会議」「会社：出張」などと表示されるようになります。
                                </p>
                            </div>

                            <div className="mb-4">
                                <h2 className="card-title text-xl mb-2">
                                    抽出された行事 ({extractedEvents.length}件)
                                </h2>
                                <p className="text-sm font-semibold text-warning mb-4">
                                    AIの解析は間違えている場合があります。内容を確認し適宜修正してからタスクに追加してください
                                </p>
                            </div>
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex gap-2">
                                    <button
                                        className="btn btn-sm btn-ghost"
                                        onClick={toggleAllEvents}
                                    >
                                        {selectedEventIndices.size === extractedEvents.length
                                            ? 'すべて解除'
                                            : 'すべて選択'}
                                    </button>
                                    <button
                                        className="btn btn-sm btn-primary"
                                        onClick={handleSaveAsTasks}
                                        disabled={selectedEventIndices.size === 0 || saving}
                                    >
                                        {saving ? (
                                            <>
                                                <span className="loading loading-spinner loading-sm"></span>
                                                保存中...
                                            </>
                                        ) : (
                                            `選択したイベントをタスクに追加 (${selectedEventIndices.size}件)`
                                        )}
                                    </button>
                                </div>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="table table-zebra w-full">
                                    <thead>
                                        <tr>
                                            <th>
                                                <input
                                                    type="checkbox"
                                                    className="checkbox checkbox-sm"
                                                    checked={
                                                        selectedEventIndices.size ===
                                                        extractedEvents.length && extractedEvents.length > 0
                                                    }
                                                    onChange={toggleAllEvents}
                                                />
                                            </th>
                                            <th>日付</th>
                                            <th>イベント</th>
                                            <th>操作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {extractedEvents.map((event, index) => (
                                            <tr
                                                key={index}
                                                className={
                                                    selectedEventIndices.has(index)
                                                        ? 'bg-primary/10'
                                                        : ''
                                                }
                                            >
                                                <td>
                                                    <input
                                                        type="checkbox"
                                                        className="checkbox checkbox-sm"
                                                        checked={selectedEventIndices.has(index)}
                                                        onChange={() =>
                                                            toggleEventSelection(index)
                                                        }
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="date"
                                                        className="input input-bordered input-sm w-full"
                                                        value={event.date}
                                                        onChange={(e) =>
                                                            handleEventDateChange(index, e.target.value)
                                                        }
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="text"
                                                        className="input input-bordered input-sm w-full"
                                                        value={event.title}
                                                        onChange={(e) =>
                                                            handleEventTitleChange(index, e.target.value)
                                                        }
                                                    />
                                                </td>
                                                <td>
                                                    <button
                                                        className="btn btn-sm btn-ghost btn-error"
                                                        onClick={() => handleDeleteEvent(index)}
                                                    >
                                                        削除
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* 新規行事追加エリア */}
                            <div className="mt-6 pt-6 border-t border-base-300">
                                <h3 className="text-lg font-semibold mb-4">新規行事を追加</h3>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                                    <div>
                                        <label className="label">
                                            <span className="label-text">日付</span>
                                        </label>
                                        <input
                                            type="date"
                                            className="input input-bordered w-full"
                                            value={newEventDate}
                                            onChange={(e) => setNewEventDate(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="label">
                                            <span className="label-text">イベント</span>
                                        </label>
                                        <input
                                            type="text"
                                            className="input input-bordered w-full"
                                            placeholder="イベント名を入力"
                                            value={newEventTitle}
                                            onChange={(e) => setNewEventTitle(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <button
                                            className="btn btn-primary w-full"
                                            onClick={handleAddNewEvent}
                                        >
                                            新規追加
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* 日付順に並び替えボタン */}
                            <div className="mt-6 flex justify-end">
                                <button
                                    className="btn btn-sm btn-outline"
                                    onClick={handleSortByDate}
                                >
                                    日付順に並び替え
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </Layout>
    );
}
