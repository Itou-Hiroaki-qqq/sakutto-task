'use client';

import { useState, useEffect } from 'react';
import { format, getYear, getMonth } from 'date-fns';
import { ja } from 'date-fns/locale';

interface YearMonthPickerProps {
    value: Date;
    onChange: (date: Date) => void;
    onClose: () => void;
}

export default function YearMonthPicker({ value, onChange, onClose }: YearMonthPickerProps) {
    const [selectedYear, setSelectedYear] = useState(getYear(value));
    const [selectedMonth, setSelectedMonth] = useState(getMonth(value));

    // 現在年から前後10年分の年リストを生成
    const currentYear = new Date().getFullYear();
    const years = Array.from({ length: 21 }, (_, i) => currentYear - 10 + i);
    const months = Array.from({ length: 12 }, (_, i) => i);

    const handleApply = () => {
        const newDate = new Date(selectedYear, selectedMonth, 1);
        onChange(newDate);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <div
                className="bg-base-100 rounded-lg shadow-xl p-6 max-w-md w-full mx-4"
                onClick={(e) => e.stopPropagation()}
            >
                <h3 className="text-lg font-semibold mb-4">年月を選択</h3>

                <div className="grid grid-cols-2 gap-4 mb-6">
                    {/* 年選択 */}
                    <div>
                        <label className="label">
                            <span className="label-text font-semibold">年</span>
                        </label>
                        <select
                            className="select select-bordered w-full"
                            value={selectedYear}
                            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                        >
                            {years.map((year) => (
                                <option key={year} value={year}>
                                    {year}年
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* 月選択 */}
                    <div>
                        <label className="label">
                            <span className="label-text font-semibold">月</span>
                        </label>
                        <select
                            className="select select-bordered w-full"
                            value={selectedMonth}
                            onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                        >
                            {months.map((month) => (
                                <option key={month} value={month}>
                                    {month + 1}月
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="flex justify-end gap-2">
                    <button className="btn btn-ghost" onClick={onClose}>
                        キャンセル
                    </button>
                    <button className="btn btn-primary" onClick={handleApply}>
                        適用
                    </button>
                </div>
            </div>
        </div>
    );
}

