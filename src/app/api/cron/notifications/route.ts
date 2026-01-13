import { NextRequest, NextResponse } from 'next/server';
import { sendNotificationsForDateTime } from '@/lib/notifications';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

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

        // 現在の日時を取得（UTC）
        const now = new Date();
        
        // 日本時間（JST）に変換
        const jstTime = toZonedTime(now, 'Asia/Tokyo');
        
        // 時刻を5分刻みに丸める（GitHub Actionsのcron実行遅延に対応）
        const minutes = jstTime.getMinutes();
        const roundedMinutes = Math.floor(minutes / 5) * 5;
        const roundedTime = new Date(jstTime);
        roundedTime.setMinutes(roundedMinutes, 0, 0);
        
        // 直前の5分刻み時刻も計算（実行遅延に対応）
        const previousRoundedTime = new Date(roundedTime);
        previousRoundedTime.setMinutes(previousRoundedTime.getMinutes() - 5);
        
        const currentDate = format(roundedTime, 'yyyy-MM-dd');
        const currentTime = format(roundedTime, 'HH:mm');
        const previousTime = format(previousRoundedTime, 'HH:mm');

        console.log(`Checking notifications for ${currentDate} ${currentTime} and ${previousTime} (JST)`);
        console.log(`UTC time: ${format(now, 'yyyy-MM-dd HH:mm')} (UTC)`);
        console.log(`Original JST time: ${format(jstTime, 'yyyy-MM-dd HH:mm')} (JST), rounded to: ${currentTime}, previous: ${previousTime}`);

        // 通知を送信（現在時刻と直前の5分刻み時刻の両方を検索）
        const result1 = await sendNotificationsForDateTime(roundedTime, currentTime);
        const result2 = await sendNotificationsForDateTime(previousRoundedTime, previousTime);
        
        // 結果を統合
        const result = {
            emailCount: result1.emailCount + result2.emailCount,
            webPushCount: result1.webPushCount + result2.webPushCount,
            errors: [...result1.errors, ...result2.errors],
        };

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
