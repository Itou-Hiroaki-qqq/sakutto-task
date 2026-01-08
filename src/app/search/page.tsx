'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { createClient } from '@/lib/supabase/client';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';

interface SearchResult {
    date: string;
    taskCount: number;
}

export default function SearchPage() {
    const router = useRouter();
    const [searchQuery, setSearchQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [userId, setUserId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);

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

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!searchQuery.trim() || !userId) return;

        setLoading(true);
        setHasSearched(true);

        try {
            const response = await fetch(`/api/tasks/search?q=${encodeURIComponent(searchQuery)}`);
            if (response.ok) {
                const data = await response.json();
                setResults(data.results || []);
            } else {
                setResults([]);
            }
        } catch (error) {
            console.error('Search failed:', error);
            setResults([]);
        } finally {
            setLoading(false);
        }
    };

    const handleDateClick = (dateStr: string) => {
        router.push(`/top?date=${dateStr}`);
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
            <div className="container mx-auto px-4 py-6">
                <h1 className="text-2xl font-bold mb-6">検索ページ</h1>

                {/* 検索フォーム */}
                <form onSubmit={handleSearch} className="mb-6">
                    <div className="flex gap-4">
                        <input
                            type="text"
                            placeholder="検索したいワードを入力"
                            className="input input-bordered flex-1"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={loading || !searchQuery.trim()}
                        >
                            {loading ? (
                                <span className="loading loading-spinner"></span>
                            ) : (
                                '検索'
                            )}
                        </button>
                    </div>
                </form>

                {/* 検索結果 */}
                {hasSearched && (
                    <div className="space-y-2">
                        {loading ? (
                            <div className="flex items-center justify-center py-12">
                                <span className="loading loading-spinner loading-lg"></span>
                            </div>
                        ) : results.length > 0 ? (
                            results.map((result) => {
                                const date = new Date(result.date);
                                const dateStr = format(date, 'yyyy-MM-dd');
                                const displayDate = format(date, 'yyyy年M月d日(E)', { locale: ja });

                                return (
                                    <button
                                        key={dateStr}
                                        onClick={() => handleDateClick(dateStr)}
                                        className="btn btn-outline w-full justify-start"
                                    >
                                        <div className="flex items-center justify-between w-full">
                                            <span>{displayDate}</span>
                                            <span className="badge badge-primary badge-lg">
                                                {result.taskCount}件
                                            </span>
                                        </div>
                                    </button>
                                );
                            })
                        ) : (
                            <div className="alert alert-info">
                                <span>検索結果が見つかりませんでした</span>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </Layout>
    );
}

