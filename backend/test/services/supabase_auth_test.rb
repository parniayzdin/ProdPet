require "test_helper"

class SupabaseAuthTest < ActiveSupport::TestCase
  USER_ID = AuthenticatedRequests::USER_ID

  setup do
    @keys = %w[SUPABASE_URL SUPABASE_ANON_KEY VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY]
    @saved = @keys.to_h { |key| [key, ENV[key]] }
    @keys.each { |key| ENV.delete(key) }
    ENV["SUPABASE_URL"] = "https://auth.example"
    ENV["SUPABASE_ANON_KEY"] = "public-test-key"
  end

  teardown do
    @saved.each { |key, value| ENV[key] = value }
  end

  def response_for(code, body)
    response = Net::HTTPResponse::CODE_TO_OBJ.fetch(code).new("1.1", code, "")
    response.body = body.to_json
    response.instance_variable_set(:@read, true)
    response
  end

  def with_auth_server(response, &block)
    http = Minitest::Mock.new
    http.expect(:request, response) do |request|
      assert_equal "/auth/v1/user", request.path
      assert_equal "Bearer actual-token", request["Authorization"]
      assert_equal "public-test-key", request["apikey"]
      true
    end
    transport = lambda do |host, port, **options, &request|
      assert_equal "auth.example", host
      assert_equal 443, port
      assert options[:use_ssl]
      assert_equal 5, options[:read_timeout]
      request.call(http)
    end
    Net::HTTP.stub(:start, transport, &block)
    http.verify
  end

  test "tokens are verified with Supabase instead of trusting decoded claims" do
    with_auth_server(response_for("200", { id: USER_ID })) do
      assert_equal USER_ID, SupabaseAuth.user_id("actual-token")
    end
  end

  test "expired tokens and malformed account responses are rejected" do
    [["401", {}], ["200", {}], ["200", { id: "not-a-uuid" }]].each do |code, body|
      with_auth_server(response_for(code, body)) do
        assert_raises(SupabaseAuth::Unauthorized) { SupabaseAuth.user_id("actual-token") }
      end
    end
  end

  test "outages and rate limiting are reported as unavailable" do
    %w[500 429].each do |code|
      with_auth_server(response_for(code, {})) do
        assert_raises(SupabaseAuth::Unavailable) { SupabaseAuth.user_id("actual-token") }
      end
    end
    Net::HTTP.stub(:start, ->(*) { raise Net::ReadTimeout }) do
      assert_raises(SupabaseAuth::Unavailable) { SupabaseAuth.user_id("actual-token") }
    end
  end

  test "missing configuration fails closed and frontend values can supply public config" do
    ENV.delete("SUPABASE_ANON_KEY")
    assert_raises(SupabaseAuth::Unavailable) { SupabaseAuth.user_id("actual-token") }
    ENV["VITE_SUPABASE_ANON_KEY"] = "public-test-key"
    with_auth_server(response_for("200", { id: USER_ID })) do
      assert_equal USER_ID, SupabaseAuth.user_id("actual-token")
    end
  end

  test "insecure remote auth URLs are rejected before sending tokens" do
    ENV["SUPABASE_URL"] = "http://auth.example"
    assert_raises(SupabaseAuth::Unavailable) { SupabaseAuth.user_id("actual-token") }
  end
end
