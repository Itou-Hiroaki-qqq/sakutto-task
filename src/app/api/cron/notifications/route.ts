import { NextRequest, NextResponse } from 'next/server';
import { sendNotificationsForDateTime } from '@/lib/notifications';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

// cron-job.orgから呼び出されるエンドポイント
// このエンドポイントは5分ごとに実行される想定
export async function POST(request: NextRequest) {
    try {
        // 認証（セキュリティのため）
        const authHeader = request.headers.get('authorization');
        const cronSecret = process.env.CRON_SECRET;

        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // 現在の日時を取得（UTC）
        const now = new Date();

        // 日本時間（JST）に変換
        const jstTime = toZonedTime(now, 'Asia/Tokyo');

        // 時刻を5分刻みに丸める
        const minutes = jstTime.getMinutes();
        const roundedMinutes = Math.floor(minutes / 5) * 5;
        const roundedTime = new Date(jstTime);
        roundedTime.setMinutes(roundedMinutes, 0, 0);

        const currentDate = format(roundedTime, 'yyyy-MM-dd');
        const currentTime = format(roundedTime, 'HH:mm');

        // 現在時刻の5分刻み時刻について通知を送信
        const result = await sendNotificationsForDateTime(roundedTime, currentTime);

        return NextResponse.json({
            success: true,
            date: currentDate,
            time: currentTime,
            emailCount: result.emailCount,
            webPushCount: result.webPushCount,
            errors: result.errors,
        }, {
            headers: {
                'Content-Type': 'application/json',
            },
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
