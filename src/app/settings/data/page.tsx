'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { createClient } from '@/lib/supabase/client';

export default function DataManagementPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [importing, setImporting] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [importResult, setImportResult] = useState<{
        importedTasks: number;
        importedMemorials: number;
        errors?: string[];
    } | null>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [importData, setImportData] = useState<any>(null);
    const [showConfirmDialog, setShowConfirmDialog] = useState(false);

    const handleExport = async () => {
        setLoading(true);
        setMessage(null);

        try {
            const response = await fetch('/api/export');

            if (!response.ok) {
                throw new Error('エクスポートに失敗しました');
            }

            const data = await response.json();

            // JSONファイルをダウンロード
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `sakutto-task-backup-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            setMessage({ type: 'success', text: 'データのエクスポートが完了しました' });
        } catch (error) {
            console.error('Export error:', error);
            setMessage({
                type: 'error',
                text: error instanceof Error ? error.message : 'エクスポートに失敗しました',
            });
        } finally {
            setLoading(false);
        }
    };

    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }

        try {
            // ファイルを読み込む
            const text = await file.text();
            const data = JSON.parse(text);
            
            setSelectedFile(file);
            setImportData(data);
            setShowConfirmDialog(true);
        } catch (error) {
            console.error('File read error:', error);
            setMessage({
                type: 'error',
                text: 'ファイルの読み込みに失敗しました。JSONファイルを選択してください。',
            });
            event.target.value = '';
        }
    };

    const handleConfirmImport = async () => {
        if (!importData) {
            return;
        }

        setShowConfirmDialog(false);
        setImporting(true);
        setMessage(null);
        setImportResult(null);

        try {
            // インポートAPIを呼び出し
            const response = await fetch('/api/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(importData),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'インポートに失敗しました');
            }

            const result = await response.json();
            setImportResult(result);

            if (result.errors && result.errors.length > 0) {
                setMessage({
                    type: 'error',
                    text: `一部のデータのインポートに失敗しました（成功: タスク ${result.importedTasks}件、記念日 ${result.importedMemorials}件）`,
                });
            } else {
                setMessage({
                    type: 'success',
                    text: `データのインポートが完了しました（タスク ${result.importedTasks}件、記念日 ${result.importedMemorials}件）`,
                });
            }

            // ファイル選択をリセット
            setSelectedFile(null);
            setImportData(null);
        } catch (error) {
            console.error('Import error:', error);
            setMessage({
                type: 'error',
                text: error instanceof Error ? error.message : 'インポートに失敗しました',
            });
        } finally {
            setImporting(false);
        }
    };

    const handleCancelImport = () => {
        setShowConfirmDialog(false);
        setSelectedFile(null);
        setImportData(null);
        // ファイル入力欄をリセット
        const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
        if (fileInput) {
            fileInput.value = '';
        }
    };

    return (
        <Layout>
            <div className="container mx-auto px-4 py-6 max-w-2xl">
                <h1 className="text-3xl font-bold mb-6">データ管理</h1>

                {/* メッセージ表示 */}
                {message && (
                    <div className={`alert ${message.type === 'success' ? 'alert-success' : 'alert-error'} mb-6`}>
                        <span>{message.text}</span>
                    </div>
                )}

                {/* エクスポート */}
                <div className="card bg-base-100 shadow-xl mb-6">
                    <div className="card-body">
                        <h2 className="card-title text-xl mb-4">データのエクスポート</h2>
                        <p className="text-base-content/70 mb-4">
                            タスクと記念日のデータをJSON形式でダウンロードできます。
                            バックアップとして保存しておくと、万が一の際にデータを復元できます。
                        </p>
                        <div className="card-actions justify-end">
                            <button
                                className="btn btn-primary"
                                onClick={handleExport}
                                disabled={loading}
                            >
                                {loading ? (
                                    <>
                                        <span className="loading loading-spinner loading-sm"></span>
                                        エクスポート中...
                                    </>
                                ) : (
                                    'データをエクスポート'
                                )}
                            </button>
                        </div>
                    </div>
                </div>

                {/* インポート */}
                <div className="card bg-base-100 shadow-xl mb-6">
                    <div className="card-body">
                        <h2 className="card-title text-xl mb-4">データのインポート</h2>
                        <p className="text-base-content/70 mb-4">
                            エクスポートしたJSONファイルをアップロードして、データを復元できます。
                            既存のデータに追加される形式でインポートされます（既存データは削除されません）。
                        </p>
                        <div className="card-actions justify-end">
                            <input
                                type="file"
                                accept=".json"
                                onChange={handleFileSelect}
                                disabled={importing}
                                className="file-input file-input-bordered file-input-primary w-full max-w-xs"
                            />
                        </div>
                        {importing && (
                            <div className="mt-4">
                                <span className="loading loading-spinner loading-sm"></span>
                                <span className="ml-2">インポート中...</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* 確認ダイアログ */}
                {showConfirmDialog && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                        <div className="bg-base-100 rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
                            <h3 className="text-xl font-bold mb-4">データをインポートしますか？</h3>
                            <p className="mb-6">
                                既存データに上書きされず、既存のデータに追加される形でインポートされますが、本当にインポートしますか？
                            </p>
                            <div className="flex justify-end gap-3">
                                <button
                                    className="btn btn-ghost"
                                    onClick={handleCancelImport}
                                    disabled={importing}
                                >
                                    キャンセル
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleConfirmImport}
                                    disabled={importing}
                                >
                                    インポートする
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* インポート結果の詳細表示 */}
                {importResult && importResult.errors && importResult.errors.length > 0 && (
                    <div className="card bg-base-100 shadow-xl mb-6">
                        <div className="card-body">
                            <h2 className="card-title text-xl mb-4 text-error">インポートエラー詳細</h2>
                            <div className="space-y-2">
                                {importResult.errors.map((error, index) => (
                                    <div key={index} className="text-sm text-error">
                                        {error}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* 戻るボタン */}
                <div className="flex justify-end">
                    <button
                        className="btn btn-ghost"
                        onClick={() => router.back()}
                    >
                        戻る
                    </button>
                </div>
            </div>
        </Layout>
    );
}
