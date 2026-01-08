'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import YearMonthPicker from './YearMonthPicker';

interface HeaderProps {
    currentDate?: Date;
    onDateChange?: (date: Date) => void;
}

export default function Header({ currentDate = new Date(), onDateChange }: HeaderProps) {
    const router = useRouter();
    const pathname = usePathname();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [showYearMonthPicker, setShowYearMonthPicker] = useState(false);

    const handleLogout = async () => {
        const supabase = createClient();
        await supabase.auth.signOut();
        router.push('/login');
        router.refresh();
    };

    const handleYearMonthChange = (date: Date) => {
        if (onDateChange) {
            onDateChange(date);
        }
    };

    const year = format(currentDate, 'yyyy');
    const month = format(currentDate, 'M月', { locale: ja });

    return (
        <header className="navbar bg-base-100 shadow-lg">
            <div className="flex-1">
                <Link 
                    href={`/top?date=${format(new Date(), 'yyyy-MM-dd')}`}
                    className="btn btn-ghost text-xl"
                >
                    さくっとタスク
                </Link>
            </div>

            {/* 年月表示 */}
            <button
                onClick={() => setShowYearMonthPicker(true)}
                className="flex flex-col items-center mr-4 hover:opacity-70 transition-opacity cursor-pointer"
            >
                <span className="text-xs leading-none">{year}</span>
                <span className="text-lg font-semibold leading-none">{month}</span>
            </button>
            {showYearMonthPicker && (
                <YearMonthPicker
                    value={currentDate}
                    onChange={handleYearMonthChange}
                    onClose={() => setShowYearMonthPicker(false)}
                />
            )}

            {/* タスク編集アイコン */}
            <Link
                href={`/task${currentDate ? `?date=${format(currentDate, 'yyyy-MM-dd')}` : ''}`}
                className="btn btn-ghost btn-circle mr-2"
                title="タスクを追加"
            >
                <span className="material-icons">add_task</span>
            </Link>

            {/* ハンバーガーメニュー */}
            <div className="dropdown dropdown-end">
                <label tabIndex={0} className="btn btn-ghost btn-circle">
                    <span className="material-icons">menu</span>
                </label>
                <ul
                    tabIndex={0}
                    className="dropdown-content menu bg-base-100 rounded-box z-1 w-52 p-2 shadow-lg"
                >
                    <li>
                        <Link 
                            href={`/top?date=${format(new Date(), 'yyyy-MM-dd')}`}
                            className={pathname === '/top' ? 'active' : ''}
                        >
                            TOP
                        </Link>
                    </li>
                    <li>
                        <Link
                            href="/weekly"
                            className={pathname === '/weekly' ? 'active' : ''}
                        >
                            週間表示
                        </Link>
                    </li>
                    <li>
                        <Link
                            href="/search"
                            className={pathname === '/search' ? 'active' : ''}
                        >
                            検索
                        </Link>
                    </li>
                    <li>
                        <button onClick={handleLogout}>ログアウト</button>
                    </li>
                </ul>
            </div>
        </header>
    );
}

