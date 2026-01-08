'use client';

import { DisplayTask } from '@/types/database';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { getHoliday } from '@/lib/holidays';
import Link from 'next/link';

interface TodoListProps {
    date: Date;
    tasks: DisplayTask[];
    onToggleCompletion: (taskId: string, completed: boolean) => void;
}

export default function TodoList({ date, tasks, onToggleCompletion }: TodoListProps) {
    const holiday = getHoliday(date);
    const dateStr = format(date, 'yyyy年M月d日(E)', { locale: ja });

    // 時間表示があるタスクとないタスクに分ける
    const tasksWithTime = tasks.filter((t) => t.notification_time);
    const tasksWithoutTime = tasks.filter((t) => !t.notification_time);

    return (
        <div className="todo-zone">
            {/* 祝日情報 */}
            {holiday && (
                <div className="alert alert-info mb-4">
                    <span>{holiday.name}</span>
                </div>
            )}

            {/* 日付表示 */}
            <h2 className="text-xl font-bold mb-4">{dateStr}</h2>

            {/* Todoリスト */}
            <div className="space-y-2">
                {/* 時間表示があるタスク */}
                {tasksWithTime.map((task) => (
                    <TodoItem
                        key={task.id}
                        task={task}
                        onToggleCompletion={onToggleCompletion}
                    />
                ))}

                {/* 時間表示がないタスク */}
                {tasksWithoutTime.map((task) => (
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
                href={`/task?taskId=${task.task_id}&date=${format(task.date, 'yyyy-MM-dd')}`}
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

