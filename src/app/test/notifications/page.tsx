'use client';

import { useState } from 'react';
import Layout from '@/components/Layout';
import { format } from 'date-fns';

export default function TestNotificationsPage() {
    const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [time, setTime] = useState(format(new Date(), 'HH:mm'));
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<any>(null);

    const handleSend = async () => {
        setLoading(true);
        setResult(null);

        try {
            const response = await fetch('/api/test/notifications', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date, time }),
            });

            const data = await response.json();
            setResult(data);
        } catch (error) {
            setResult({ success: false, error: '送信に失敗しました' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Layout>
            <div className="container mx-auto px-4 py-6 max-w-2xl">
                <h1 className="text-3xl font-bold mb-6">通知送信テスト</h1>
                <div className="alert alert-warning mb-6">
                    <div>
                        <h3 className="font-bold">注意</h3>
                        <p className="text-sm">
                            このページは開発環境（localhost）でのみ動作します。
                            本番環境では使用できません。
                        </p>
                    </div>
                </div>
                <p className="text-sm text-base-content/70 mb-6">
                    指定した日時で通知を送信するタスクがある場合、メール通知またはWeb Push通知が送信されます。
                </p>

                <div className="card bg-base-100 shadow-xl mb-6">
                    <div className="card-body">
                        <div className="form-control mb-4">
                            <label className="label">
                                <span className="label-text">日付</span>
                            </label>
                            <input
                                type="date"
                                className="input input-bordered"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                            />
                        </div>

                        <div className="form-control mb-4">
                            <label className="label">
                                <span className="label-text">時刻（HH:mm形式）</span>
                            </label>
                            <input
                                type="time"
                                className="input input-bordered"
                                value={time}
                                onChange={(e) => setTime(e.target.value)}
                            />
                        </div>

                        <button
                            className="btn btn-primary"
                            onClick={handleSend}
                            disabled={loading}
                        >
                            {loading ? (
                                <>
                                    <span className="loading loading-spinner loading-sm"></span>
                                    送信中...
                                </>
                            ) : (
                                '通知を送信'
                            )}
                        </button>
                    </div>
                </div>

                {result && (
                    <div className={`alert ${result.success ? 'alert-success' : 'alert-error'}`}>
                        <div>
                            <h3 className="font-bold">
                                {result.success ? '送信完了' : 'エラー'}
                            </h3>
                            <div className="text-sm mt-2">
                                {result.message && <p>{result.message}</p>}
                                {result.date && <p>日付: {result.date}</p>}
                                {result.time && <p>時刻: {result.time}</p>}
                                {result.emailCount !== undefined && (
                                    <p>メール通知送信数: {result.emailCount}</p>
                                )}
                                {result.webPushCount !== undefined && (
                                    <p>Web Push通知送信数: {result.webPushCount}</p>
                                )}
                                {result.errors && result.errors.length > 0 && (
                                    <div className="mt-2">
                                        <p className="font-semibold">エラー:</p>
                                        <ul className="list-disc list-inside space-y-1">
                                            {result.errors.map((error: string, index: number) => (
                                                <li key={index} className="break-all">{error}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                {result.error && <p className="text-red-600">{result.error}</p>}
                            </div>
                        </div>
                    </div>
                )}

                <div className="alert alert-info mt-6">
                    <div>
                        <h3 className="font-bold">使い方</h3>
                        <ol className="list-decimal list-inside mt-2 space-y-1 text-sm">
                            <li>通知設定ページでメールアドレスまたはWeb Push通知を設定</li>
                            <li>タスク編集ページで通知を有効にして、通知時刻を設定</li>
                            <li>上記の日付・時刻を、設定したタスクの日付・時刻に合わせる</li>
                            <li>「通知を送信」ボタンをクリック</li>
                            <li>メールまたはブラウザ通知が届くことを確認</li>
                        </ol>
                    </div>
                </div>
            </div>
        </Layout>
    );
}
