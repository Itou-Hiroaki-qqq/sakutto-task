import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getTasksForDateRange } from '@/lib/tasks';
import { format, parseISO, addMonths, subMonths } from 'date-fns';

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const startDateStr = searchParams.get('startDate');
        const endDateStr = searchParams.get('endDate');
        const centerDateStr = searchParams.get('centerDate'); // 中心日（現在日±1ヶ月を計算する場合）

        let startDate: Date;
        let endDate: Date;

        if (centerDateStr) {
            // centerDateを基準に前後1ヶ月を計算
            const centerDate = parseISO(centerDateStr);
            startDate = subMonths(centerDate, 1);
            endDate = addMonths(centerDate, 1);
        } else if (startDateStr && endDateStr) {
            // startDateとendDateを直接指定
            startDate = parseISO(startDateStr);
            endDate = parseISO(endDateStr);
        } else {
            // デフォルト: 現在日を基準に前後1ヶ月
            const today = new Date();
            startDate = subMonths(today, 1);
            endDate = addMonths(today, 1);
        }

        // 日付を正規化（時刻を00:00:00に設定）
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);

        // 日付範囲を取得
        const tasksByDate = await getTasksForDateRange(user.id, startDate, endDate);

        // Mapをオブジェクトに変換（キーを保持）
        const tasksObject: Record<string, any[]> = {};
        tasksByDate.forEach((tasks, dateStr) => {
            tasksObject[dateStr] = tasks;
        });

        return NextResponse.json({
            tasks: tasksObject,
            startDate: format(startDate, 'yyyy-MM-dd'),
            endDate: format(endDate, 'yyyy-MM-dd'),
        });
    } catch (error) {
        console.error('Error fetching tasks range:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
