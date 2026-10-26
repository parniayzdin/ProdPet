require "test_helper"

class SessionApiTest < ActionDispatch::IntegrationTest
  include AuthenticatedRequests

  test "short race scores on the server and retry creates only one activity event" do
    signed_in do
      data = payload(total: 99999, bonus: 99999, user_id: OTHER_ID)
      assert_difference ["FocusSession.count", "ActivityEvent.count"], 1 do
        post "/sessions", params: data, headers: headers, as: :json
        assert_response :created
      end
      assert_equal USER_ID, body["user_id"]
      assert_equal 50, body["total"]
      assert_equal 0, body["bonus"]
      original = body
      assert_no_difference ["FocusSession.count", "ActivityEvent.count"] do
        post "/sessions", params: data, headers: headers, as: :json
        assert_response :ok
        assert_equal original, body
      end
      post "/sessions", params: data.merge(task: "Different"), headers: headers, as: :json
      assert_response :conflict
    end
  end

  test "completed quests earn a bonus and interrupted quests do not" do
    signed_in do
      post "/sessions", params: payload(mode: "quest", duration: 900, seconds: 900), headers: headers, as: :json
      assert_response :created
      assert_equal 225, body["total"]
      post "/sessions", params: payload(mode: "quest", duration: 900, seconds: 899), headers: headers, as: :json
      assert_equal 140, body["total"]
      assert_equal 0, body["bonus"]
    end
  end

  test "timezone-equivalent retries are idempotent and lists are newest first" do
    signed_in do
      data = payload(date: "2026-10-20T10:00:00-04:00")
      post "/sessions", params: data, headers: headers, as: :json
      assert_response :created
      post "/sessions", params: data.merge(date: "2026-10-20T14:00:00Z"), headers: headers, as: :json
      assert_response :ok
      latest = payload(date: "2026-10-21T14:00:00Z")
      post "/sessions", params: latest, headers: headers, as: :json
      get "/users/#{USER_ID}/sessions", headers: headers
      assert_equal [latest[:id], data[:id]], body.map { |row| row["id"] }
    end
  end

  test "invalid sessions are rejected without writes" do
    invalid = [
      { id: "no" }, { task: "" }, { task: "a" * 121 }, { seconds: 59 },
      { seconds: 301 }, { seconds: 61.5 }, { seconds: true }, { duration: 700 },
      { mode: "unknown" }, { date: "2026-10-20T10:00:00" }, { date: "garbage" }
    ]
    signed_in do
      invalid.each do |changes|
        assert_no_difference ["FocusSession.count", "ActivityEvent.count"] do
          post "/sessions", params: payload(**changes), headers: headers, as: :json
          assert_response :unprocessable_entity, changes.inspect
        end
      end
    end
  end

  test "owner checks prevent reads and same id writes across users" do
    data = payload
    signed_in { post "/sessions", params: data, headers: headers, as: :json }
    signed_in(OTHER_ID) do
      %w[sessions stats focus-quality].each do |resource|
        get "/users/#{USER_ID}/#{resource}", headers: headers
        assert_response :forbidden
      end
      post "/sessions", params: data, headers: headers, as: :json
      assert_response :conflict
      get "/users/#{OTHER_ID}/sessions", headers: headers
      assert_equal [], body
    end
  end

  test "session and event roll back together on persistence failure" do
    signed_in do
      ActivityEvent.stub(:create!, ->(**_) { raise ActiveRecord::RecordInvalid.new(ActivityEvent.new) }) do
        assert_no_difference ["FocusSession.count", "ActivityEvent.count"] do
          post "/sessions", params: payload, headers: headers, as: :json
          assert_response :unprocessable_entity
        end
      end
    end
  end

  test "health is public and all data endpoints require authentication" do
    get "/health"
    assert_response :ok
    assert_equal "ok", body["status"]
    %w[sessions stats focus-quality].each do |resource|
      get "/users/#{USER_ID}/#{resource}"
      assert_response :unauthorized
    end
    %w[sessions penalties presence].each do |resource|
      post "/#{resource}", params: {}, as: :json
      assert_response :unauthorized
    end
  end

  test "CORS allows Vite preflight and rejects unrelated origins" do
    options "/sessions", headers: { "Origin" => "http://127.0.0.1:5174",
      "Access-Control-Request-Method" => "POST", "Access-Control-Request-Headers" => "authorization,content-type" }
    assert_equal "http://127.0.0.1:5174", response.headers["Access-Control-Allow-Origin"]
    options "/sessions", headers: { "Origin" => "https://unrelated.example", "Access-Control-Request-Method" => "POST" }
    assert_nil response.headers["Access-Control-Allow-Origin"]
  end
end
