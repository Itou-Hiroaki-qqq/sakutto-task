import { NextRequest, NextResponse } from 'next/server';
import { sendNotificationsForDateTime } from '@/lib/notifications';
import { parseISO, format } from 'date-fns';

// テスト用: 手動で通知を送信するエンドポイント
// 開発環境での動作確認用
export async function POST(request: NextRequest) {
    try {
        // 開発環境でのみ動作（本番環境では無効化推奨）
        if (process.env.NODE_ENV === 'production') {
            return NextResponse.json(
                { error: 'This endpoint is only available in development' },
                { status: 403 }
            );
        }

        const body = await request.json();
        const { date, time } = body;

        // 日時をパース（指定がない場合は現在時刻）
        let targetDate: Date;
        let targetTime: string;

        if (date && time) {
            // 指定された日時を使用
            const dateTimeStr = `${date} ${time}`;
            targetDate = parseISO(dateTimeStr);
            targetTime = time;
        } else if (date) {
            // 日付のみ指定された場合、現在時刻を使用
            targetDate = parseISO(date);
            targetTime = format(new Date(), 'HH:mm');
        } else {
            // 何も指定されていない場合、現在時刻を使用
            targetDate = new Date();
            targetTime = format(targetDate, 'HH:mm');
        }

        console.log(`[TEST] Sending notifications for ${format(targetDate, 'yyyy-MM-dd')} ${targetTime}`);

        // 通知を送信
        const result = await sendNotificationsForDateTime(targetDate, targetTime);

        return NextResponse.json({
            success: true,
            date: format(targetDate, 'yyyy-MM-dd'),
            time: targetTime,
            emailCount: result.emailCount,
            webPushCount: result.webPushCount,
            errors: result.errors,
            message: '通知の送信を試みました',
        });
    } catch (error) {
        console.error('[TEST] Failed to send test notifications:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
}
