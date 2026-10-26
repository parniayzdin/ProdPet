ENV["RAILS_ENV"] = "test"
require_relative "../config/environment"
require "rails/test_help"
require "minitest/mock"

class ActiveSupport::TestCase
  # Rails loads schema.rb into the isolated test DB; never use developer data.
  self.use_transactional_tests = true
end

module AuthenticatedRequests
  USER_ID = "11111111-1111-4111-8111-111111111111"
  OTHER_ID = "22222222-2222-4222-8222-222222222222"

  def signed_in(user_id = USER_ID, &block)
    SupabaseAuth.stub(:user_id, user_id, &block)
  end

  def headers
    { "Authorization" => "Bearer test-token" }
  end

  def payload(**changes)
    {
      id: SecureRandom.uuid, task: "Study Ruby", date: Time.current.utc.iso8601(6),
      seconds: 300, duration: 300, mode: "focus"
    }.merge(changes)
  end

  def body
    response.parsed_body
  end
end
