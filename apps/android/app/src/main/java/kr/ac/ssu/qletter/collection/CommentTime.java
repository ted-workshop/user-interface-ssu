package kr.ac.ssu.qletter.collection;

import android.content.Context;
import android.text.format.DateFormat;
import java.util.Calendar;
import kr.ac.ssu.qletter.R;

/** 피그마처럼 댓글 시간을 "방금·N분 전·N시간 전·어제·11월 18일"로 바꿔요. */
final class CommentTime {
  private static final long MINUTE = 60_000L;
  private static final long HOUR = 60 * MINUTE;

  private CommentTime() {}

  static String label(Context context, long createdAtMillis) {
    long diff = System.currentTimeMillis() - createdAtMillis;
    if (diff < MINUTE) return context.getString(R.string.comment_time_now);
    if (diff < HOUR) return context.getString(R.string.comment_time_minutes, (int) (diff / MINUTE));
    Calendar created = Calendar.getInstance();
    created.setTimeInMillis(createdAtMillis);
    Calendar today = Calendar.getInstance();
    if (sameDay(created, today))
      return context.getString(R.string.comment_time_hours, (int) (diff / HOUR));
    today.add(Calendar.DAY_OF_YEAR, -1);
    if (sameDay(created, today)) return context.getString(R.string.comment_time_yesterday);
    return DateFormat.format(context.getString(R.string.comment_time_date), created).toString();
  }

  private static boolean sameDay(Calendar a, Calendar b) {
    return a.get(Calendar.YEAR) == b.get(Calendar.YEAR)
        && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR);
  }
}
