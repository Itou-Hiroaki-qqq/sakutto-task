import { NextRequest, NextResponse } from 'next/server';
import { sendNotificationsForDateTime } from '@/lib/notifications';
import { format } from 'date-fns';

// Vercel Cron Jobから呼び出されるエンドポイント
// このエンドポイントは毎分実行される想定（または必要に応じてスケジュール設定）
export async function GET(request: NextRequest) {
    try {
        // Vercel Cronの認証（オプション: セキュリティのため）
        const authHeader = request.headers.get('authorization');
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            // 開発環境では認証をスキップ（本番環境では推奨）
            if (process.env.NODE_ENV === 'production') {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }
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
