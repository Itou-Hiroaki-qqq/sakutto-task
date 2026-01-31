'use client';

import { DisplayTask } from '@/types/database';
import { format, isSameDay } from 'date-fns';
import { ja } from 'date-fns/locale';
import { getHoliday } from '@/lib/holidays';
import Link from 'next/link';

interface TodoListProps {
    date: Date;
    tasks: DisplayTask[];
    onToggleCompletion: (taskId: string, completed: boolean) => void;
    memorials?: Array<{ id: string; title: string }>;
    overdueDates?: Date[]; // 未完了の過去タスクがある日
}

export default function TodoList({ date, tasks, onToggleCompletion, memorials = [], overdueDates = [] }: TodoListProps) {
    const holiday = getHoliday(date);
    const dateStr = format(date, 'yyyy年M月d日(E)', { locale: ja });

    // チェック済みタスクを下部に移動（元の並び順を維持）
    const sortedTasks = tasks
        .map((task, index) => ({ task, index }))
        .sort((a, b) => {
            // 未完了タスクを先に、完了タスクを後に
            if (a.task.completed !== b.task.completed) {
                return a.task.completed ? 1 : -1;
            }
            // 同じ状態の場合は元の並び順を維持
            return a.index - b.index;
        })
        .map(({ task }) => task);

    return (
        <div className="todo-zone">
            {/* 祝日情報 */}
            {holiday && (
                <div className="alert alert-info mb-4">
                    <span>{holiday.name}</span>
                </div>
            )}

            {/* 記念日情報 */}
            {memorials.map((memorial) => (
                <div key={memorial.id} className="alert alert-success mb-4">
                    <span>{memorial.title}</span>
                </div>
            ))}

            {/* 日付表示 */}
            <h2 className="text-xl font-bold mb-4">{dateStr}</h2>

            {/* Todoリスト */}
            <div className="space-y-2">
                {sortedTasks.map((task) => (
                    <TodoItem
                        key={task.id}
                        task={task}
                        onToggleCompletion={onToggleCompletion}
                    />
                ))}

                {tasks.length === 0 && (
                    <div className="text-center text-base-content/50 py-8">
                        この日にタスクはありません
                    </div>
                )}
            </div>

            {/* 未完了の過去タスクがある日のメッセージ */}
            {overdueDates.length > 0 && (
                <div className="mt-6 space-y-2">
                    {overdueDates.map((overdueDate) => (
                        <div key={format(overdueDate, 'yyyy-MM-dd')} className="alert alert-warning">
                            <span>{format(overdueDate, 'M月d日', { locale: ja })}に未完了のタスクがあります</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function TodoItem({
    task,
    onToggleCompletion,
}: {
    task: DisplayTask;
    onToggleCompletion: (taskId: string, completed: boolean) => void;
}) {
    const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onToggleCompletion(task.task_id, e.target.checked);
    };

    return (
        <div className="flex items-center gap-3 p-3 bg-base-100 rounded-lg shadow hover:shadow-md transition-shadow">
            <input
                type="checkbox"
                className="checkbox checkbox-primary"
                checked={task.completed}
                onChange={handleCheckboxChange}
            />
            <Link
                href={`/task?taskId=${task.task_id}&date=${format(task.date, 'yyyy-MM-dd')}&returnUrl=${encodeURIComponent('/top')}`}
                className={`flex-1 cursor-pointer ${task.completed
                        ? 'line-through text-base-content/50'
                        : 'text-base-content'
                    }`}
            >
                <div className="flex items-center gap-2">
                    {task.notification_time && (
                        <span className="badge badge-outline badge-sm">
                            {task.notification_time}
                        </span>
                    )}
                    <span>{task.title}</span>
                </div>
            </Link>
        </div>
    );
}

