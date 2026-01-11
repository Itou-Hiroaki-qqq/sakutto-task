import { NextRequest, NextResponse } from 'next/server';
import { sendNotificationsForDateTime } from '@/lib/notifications';
import { format } from 'date-fns';

// GitHub Actions Cron Jobから呼び出されるエンドポイント
// このエンドポイントは5分ごとに実行される想定
export async function GET(request: NextRequest) {
    try {
        // 認証（セキュリティのため）
        const authHeader = request.headers.get('authorization');
        const cronSecret = process.env.CRON_SECRET;
        
        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // 現在の日時を取得
        const now = new Date();
        const currentDate = format(now, 'yyyy-MM-dd');
        const currentTime = format(now, 'HH:mm');

        console.log(`Checking notifications for ${currentDate} ${currentTime}`);

        // 通知を送信
        const result = await sendNotificationsForDateTime(now, currentTime);

        return NextResponse.json({
            success: true,
            date: currentDate,
            time: currentTime,
            emailCount: result.emailCount,
            webPushCount: result.webPushCount,
            errors: result.errors,
        });
    } catch (error) {
        console.error('Failed to process notifications:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
}
