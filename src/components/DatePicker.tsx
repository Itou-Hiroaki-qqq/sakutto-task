'use client';

import { useState } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, getDay } from 'date-fns';
import { ja } from 'date-fns/locale';

interface DatePickerProps {
    value: Date;
    onChange: (date: Date) => void;
    onClose: () => void;
}

export default function DatePicker({ value, onChange, onClose }: DatePickerProps) {
    const [displayMonth, setDisplayMonth] = useState(value);

    const monthStart = startOfMonth(displayMonth);
    const monthEnd = endOfMonth(displayMonth);

    const calendarStart = new Date(monthStart);
    calendarStart.setDate(calendarStart.getDate() - calendarStart.getDay());

    const calendarEnd = new Date(monthEnd);
    const daysToAdd = 6 - calendarEnd.getDay();
    calendarEnd.setDate(calendarEnd.getDate() + daysToAdd);

    const calendarDays = eachDayOfInterval({
        start: calendarStart,
        end: calendarEnd,
    });

    const weekDays = ['日', '月', '火', '水', '木', '金', '土'];

    const handleDateClick = (date: Date) => {
        onChange(date);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-base-100 rounded-lg shadow-xl p-4 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <button
                        onClick={() => setDisplayMonth(subMonths(displayMonth, 1))}
                        className="btn btn-sm btn-circle btn-ghost"
                    >
                        <span className="material-icons">chevron_left</span>
                    </button>
                    <h3 className="text-lg font-semibold">
                        {format(displayMonth, 'yyyy年M月', { locale: ja })}
                    </h3>
                    <button
                        onClick={() => setDisplayMonth(addMonths(displayMonth, 1))}
                        className="btn btn-sm btn-circle btn-ghost"
                    >
                        <span className="material-icons">chevron_right</span>
                    </button>
                </div>

                <div className="grid grid-cols-7 gap-1 mb-2">
                    {weekDays.map((day) => (
                        <div
                            key={day}
                            className={`text-center text-sm font-semibold p-2 ${day === '日' ? 'text-red-500' : day === '土' ? 'text-blue-500' : ''
                                }`}
                        >
                            {day}
                        </div>
                    ))}
                </div>

                <div className="grid grid-cols-7 gap-1">
                    {calendarDays.map((day, index) => {
                        const isCurrentMonth = isSameMonth(day, displayMonth);
                        const isSelected = isSameDay(day, value);
                        const isToday = isSameDay(day, new Date());

                        return (
                            <button
                                key={index}
                                onClick={() => handleDateClick(day)}
                                className={`btn btn-sm btn-ghost aspect-square p-0 ${!isCurrentMonth
                                        ? 'text-base-content/30'
                                        : isSelected
                                            ? 'btn-primary'
                                            : isToday
                                                ? 'bg-primary/20 font-bold'
                                                : ''
                                    }`}
                            >
                                {format(day, 'd')}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

