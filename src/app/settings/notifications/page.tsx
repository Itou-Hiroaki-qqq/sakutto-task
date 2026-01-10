'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { createClient } from '@/lib/supabase/client';

interface NotificationSettings {
    email: string | null;
    email_notification_enabled: boolean;
    web_push_enabled: boolean;
}

export default function NotificationSettingsPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    const [settings, setSettings] = useState<NotificationSettings>({
        email: null,
        email_notification_enabled: false,
        web_push_enabled: false,
    });
    const [email, setEmail] = useState('');
    const [loginEmail, setLoginEmail] = useState<string | null>(null);
    const [emailEnabled, setEmailEnabled] = useState(false);
    const [webPushEnabled, setWebPushEnabled] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => {
        checkAuth();
    }, []);

    useEffect(() => {
        // URLパラメータからreturnUrlを取得して保存
        const returnUrlParam = new URLSearchParams(window.location.search).get('returnUrl');
        if (returnUrlParam) {
            // returnUrlをsessionStorageに保存（保存後に戻るため）
            sessionStorage.setItem('notificationSettingsReturnUrl', returnUrlParam);
        }
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
        setLoginEmail(user.email || null);
        loadSettings();
    };

    const loadSettings = async () => {
        try {
            const response = await fetch('/api/settings/notifications');
            if (response.ok) {
                const data = await response.json();
                setSettings(data.settings);
                // 設定に保存されているメールアドレスがあればそれを使用、なければログインメールアドレスを使用
                setEmail(data.settings.email || data.loginEmail || '');
                setEmailEnabled(data.settings.email_notification_enabled || false);
                setWebPushEnabled(data.settings.web_push_enabled || false);
                if (data.loginEmail) {
                    setLoginEmail(data.loginEmail);
                }
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
            setMessage({ type: 'error', text: '設定の読み込みに失敗しました' });
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!userId) return;

        // メール通知が有効な場合、メールアドレスのバリデーション
        if (emailEnabled && !email) {
            setMessage({ type: 'error', text: 'メール通知を有効にするには、メールアドレスを入力してください' });
            return;
        }

        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            setMessage({ type: 'error', text: '有効なメールアドレスを入力してください' });
            return;
        }

        setSaving(true);
        setMessage(null);

        try {
            const response = await fetch('/api/settings/notifications', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: emailEnabled ? email : null,
                    email_notification_enabled: emailEnabled,
                    web_push_enabled: webPushEnabled,
                }),
            });

            if (response.ok) {
                setMessage({ type: 'success', text: '設定を保存しました' });
                loadSettings(); // 設定を再読み込み

                // returnUrlがあれば、保存後にそのページに戻る
                const returnUrl = sessionStorage.getItem('notificationSettingsReturnUrl');
                if (returnUrl) {
                    sessionStorage.removeItem('notificationSettingsReturnUrl');
                    setTimeout(() => {
                        router.push(returnUrl);
                    }, 1000); // 1秒後に遷移（成功メッセージを見せるため）
                    return;
                }
            } else {
                const data = await response.json();
                setMessage({ type: 'error', text: data.error || '設定の保存に失敗しました' });
            }
        } catch (error) {
            console.error('Failed to save settings:', error);
            setMessage({ type: 'error', text: '設定の保存に失敗しました' });
        } finally {
            setSaving(false);
        }
    };

    const handleWebPushToggle = async (enabled: boolean) => {
        setWebPushEnabled(enabled);

        if (enabled) {
            // Web Push通知を有効にする場合は、ブラウザの許可を求める
            try {
                const registration = await navigator.serviceWorker.ready;
                const vapidPublicKey = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;
                if (!vapidPublicKey) {
                    throw new Error('VAPID public key is not set');
                }
                const subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
                });

                // サブスクリプションをサーバーに送信
                const response = await fetch('/api/push/subscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ subscription }),
                });

                if (!response.ok) {
                    setWebPushEnabled(false);
                    setMessage({ type: 'error', text: 'Web Push通知の有効化に失敗しました' });
                }
            } catch (error) {
                console.error('Failed to enable web push:', error);
                setWebPushEnabled(false);
                setMessage({ type: 'error', text: 'Web Push通知の有効化に失敗しました。ブラウザの通知許可を確認してください。' });
            }
        } else {
            // Web Push通知を無効にする場合は、サブスクリプションを削除
            try {
                await fetch('/api/push/unsubscribe', {
                    method: 'POST',
                });
            } catch (error) {
                console.error('Failed to disable web push:', error);
            }
        }
    };

    // VAPID公開鍵をUint8Arrayに変換（Web Push用）
    const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding)
            .replace(/\-/g, '+')
            .replace(/_/g, '/');

        const rawData = window.atob(base64);
        const buffer = new ArrayBuffer(rawData.length);
        const outputArray = new Uint8Array(buffer);

        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    };

    if (loading || !userId) {
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
            <div className="container mx-auto px-4 py-6 max-w-2xl">
                <h1 className="text-3xl font-bold mb-6">通知送受信設定</h1>

                {/* メッセージ表示 */}
                {message && (
                    <div className={`alert ${message.type === 'success' ? 'alert-success' : 'alert-error'} mb-6`}>
                        <span>{message.text}</span>
                    </div>
                )}

                {/* メール通知設定 */}
                <div className="card bg-base-100 shadow-xl mb-6">
                    <div className="card-body">
                        <h2 className="card-title text-xl mb-4">メール通知設定</h2>

                        <div className="form-control mb-4">
                            <label className="label cursor-pointer">
                                <span className="label-text">メール通知を有効にする</span>
                                <input
                                    type="checkbox"
                                    className="toggle toggle-primary"
                                    checked={emailEnabled}
                                    onChange={(e) => setEmailEnabled(e.target.checked)}
                                />
                            </label>
                        </div>

                        {emailEnabled && (
                            <div className="form-control mb-4">
                                <label className="label">
                                    <span className="label-text">通知用メールアドレス</span>
                                </label>
                                <input
                                    type="email"
                                    placeholder="example@example.com"
                                    className="input input-bordered w-full"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                />
                                <label className="label">
                                    <span className="label-text-alt">
                                        タスクの期日・通知時刻にメール通知が送信されます
                                    </span>
                                </label>
                                <label className="label">
                                    <span className="label-text-alt text-base-content/60">
                                        ログインアドレスでよい場合はこのまま保存、違うアドレスを使用する場合は変更して保存してください
                                    </span>
                                </label>
                            </div>
                        )}
                    </div>
                </div>

                {/* Web Push通知設定 */}
                <div className="card bg-base-100 shadow-xl mb-6">
                    <div className="card-body">
                        <h2 className="card-title text-xl mb-4">Web Push通知設定</h2>

                        <div className="form-control mb-4">
                            <label className="label cursor-pointer">
                                <span className="label-text">Web Push通知を有効にする</span>
                                <input
                                    type="checkbox"
                                    className="toggle toggle-primary"
                                    checked={webPushEnabled}
                                    onChange={(e) => handleWebPushToggle(e.target.checked)}
                                />
                            </label>
                        </div>

                        <p className="text-sm text-base-content/70">
                            ブラウザが開いていなくても、タスクの期日・通知時刻に通知が届きます。
                            初回はブラウザの通知許可が必要です。
                        </p>
                    </div>
                </div>

                {/* 保存ボタン */}
                <div className="flex justify-end gap-4">
                    <button
                        className="btn btn-ghost"
                        onClick={() => router.back()}
                    >
                        キャンセル
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={handleSave}
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
        </Layout>
    );
}
