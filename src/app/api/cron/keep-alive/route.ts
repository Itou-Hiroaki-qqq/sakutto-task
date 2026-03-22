import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Supabaseの無料プランが非アクティブでpauseされるのを防ぐためのエンドポイント
// cron-job.orgから3日に1回GETで呼び出す
export async function GET(request: NextRequest) {
    try {
        // 認証
        const authHeader = request.headers.get('authorization');
        const cronSecret = process.env.CRON_SECRET;

        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        if (!supabaseUrl || !supabaseAnonKey) {
            return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
        }

        // Supabase に軽量リクエストを送ってアクティビティを発生させる
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        const { error } = await supabase.auth.getSession();

        return NextResponse.json({
            success: true,
            timestamp: new Date().toISOString(),
            supabaseReachable: !error,
        });
    } catch (error) {
        console.error('Keep-alive failed:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
}
