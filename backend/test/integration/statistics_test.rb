require "test_helper"

class StatisticsTest < ActionDispatch::IntegrationTest
  include AuthenticatedRequests

  test "seven day UTC window includes first midnight and excludes next midnight" do
    travel_to Time.utc(2026, 10, 26, 15) do
      signed_in do
        ["2026-10-19T23:59:59Z", "2026-10-20T00:00:00Z", "2026-10-26T23:59:59Z", "2026-10-27T00:00:00Z"].each do |date|
          post "/sessions", params: payload(date: date, seconds: 900, duration: 900), headers: headers, as: :json
          assert_response :created
        end
        get "/users/#{USER_ID}/stats", headers: headers
        assert_response :ok
        assert_equal 4, body["completed_sessions"]
        assert_equal 60, body["total_focused_minutes"]
        assert_equal 600, body["total_points"]
        assert_equal 7, body["daily"].length
        assert_equal({ "date" => "2026-10-20", "focus_minutes" => 15, "points" => 150 }, body["daily"].first)
        assert_equal 15, body["daily"].last["focus_minutes"]
        assert_equal 0, body["daily"][1]["points"]
      end
    end
  end

  test "penalties are counted once and cumulative points never become negative" do
    signed_in do
      post "/sessions", params: payload(seconds: 60), headers: headers, as: :json
      data = { id: SecureRandom.uuid, reason: "phone", tip: "Put the phone away" }
      post "/penalties", params: data, headers: headers, as: :json
      assert_response :created
      original = body
      assert_equal(-50, body["points"])
      assert_no_difference ["ActivityEvent.count", "PenaltyReceipt.count"] do
        post "/penalties", params: data, headers: headers, as: :json
        assert_response :ok
        assert_equal original, body
      end
      get "/users/#{USER_ID}/stats", headers: headers
      assert_equal 0, body["total_points"]
      assert_equal(-40, body["daily"].last["points"])
      assert_equal 1, body["total_focused_minutes"]
    end
  end

  test "all habit reasons preserve their existing point values and invalid inputs fail" do
    signed_in do
      { phone: -50, posture: -25, distracted: -40, tired: -15, stressed: -20, long_session: -30 }.each do |reason, points|
        post "/penalties", params: { id: SecureRandom.uuid, reason: reason }, headers: headers, as: :json
        assert_response :created
        assert_equal points, body["points"]
      end
      [{ reason: "unknown" }, { confidence: 2 }, { tip: "a" * 241 }, { session_id: "bad" }].each do |changes|
        post "/penalties", params: { id: SecureRandom.uuid, reason: "phone" }.merge(changes), headers: headers, as: :json
        assert_response :unprocessable_entity
      end
    end
  end

  test "old Python penalty retries do not debit points again" do
    id = SecureRandom.uuid
    ActivityEvent.create!(time: Time.current, session_id: id, user_id: USER_ID,
      event_type: "habit_penalty:posture", focus_seconds: 0, points: -25)
    signed_in do
      assert_no_difference "ActivityEvent.count" do
        post "/penalties", params: { id: id, reason: "posture" }, headers: headers, as: :json
        assert_response :ok
        assert_equal(-25, body["points"])
      end
    end
  end

  test "empty accounts get seven zero days and other users never contribute" do
    signed_in(OTHER_ID) { post "/sessions", params: payload, headers: headers, as: :json }
    signed_in do
      get "/users/#{USER_ID}/stats", headers: headers
      assert_equal 0, body["completed_sessions"]
      assert_equal 0, body["total_points"]
      assert_equal 7, body["daily"].length
      assert body["daily"].all? { |day| day["points"] == 0 && day["focus_minutes"] == 0 }
    end
  end

  test "presence preserves boolean values and session filters" do
    id = SecureRandom.uuid
    signed_in do
      [true, false, true].each do |present|
        post "/presence", params: { session_id: id, present: present, source: "vision" }, headers: headers, as: :json
        assert_response :created
        assert_equal present, body["present"]
      end
      post "/presence", params: { present: false, source: "timer" }, headers: headers, as: :json
      get "/users/#{USER_ID}/focus-quality", params: { session_id: id }, headers: headers
      assert_equal 3, body["total_ticks"]
      assert_equal 2, body["present_ticks"]
      assert_equal 66.7, body["at_desk_percent"]
      get "/users/#{USER_ID}/focus-quality", headers: headers
      assert_equal 50.0, body["at_desk_percent"]
      get "/users/#{USER_ID}/focus-quality", params: { session_id: SecureRandom.uuid }, headers: headers
      assert_equal 0.0, body["at_desk_percent"]
      post "/presence", params: { present: "false" }, headers: headers, as: :json
      assert_response :unprocessable_entity
    end
  end
end
