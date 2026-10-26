class UserStatistics
  def initialize(user_id)
    @user_id = user_id
  end

  def as_json
    sessions = FocusSession.where(user_id: @user_id)
    events = ActivityEvent.where(user_id: @user_id)
    start = Time.current.utc.beginning_of_day - 6.days
    finish = start + 7.days
    # DATE() works with UTC values on both SQLite and plain PostgreSQL.
    # PostgreSQL timestamps with timezone need an explicit UTC bucket.
    bucket = "DATE(time)"
    if ActivityEvent.connection.adapter_name == "PostgreSQL"
      bucket = "DATE(time AT TIME ZONE 'UTC')"
    end
    rows = events.scored.where(time: start...finish).group(Arel.sql(bucket)).pluck(
      Arel.sql(bucket),
      Arel.sql("SUM(CASE WHEN event_type = 'session_completed' THEN focus_seconds ELSE 0 END)"),
      Arel.sql("SUM(points)")
    )
    daily_totals = rows.to_h { |day, seconds, points| [day.to_s, [seconds.to_i / 60, points.to_i]] }
    daily = (0...7).map do |offset|
      day = (start + offset.days).to_date.iso8601
      minutes, points = daily_totals.fetch(day, [0, 0])
      { date: day, focus_minutes: minutes, points: points }
    end

    {
      user_id: @user_id,
      total_points: [0, sessions.sum(:total) + events.penalties.sum(:points)].max,
      completed_sessions: sessions.count,
      total_focused_minutes: sessions.sum(:seconds) / 60,
      daily: daily
    }
  end
end
