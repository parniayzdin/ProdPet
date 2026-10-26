require "net/http"

# Supabase verifies the signature, expiry and account for all supported signing keys.
# This matches the existing Node friends server's authentication contract.
class SupabaseAuth
  class Unauthorized < StandardError; end
  class Unavailable < StandardError; end

  def self.user_id(token)
    url = ENV["SUPABASE_URL"].presence || ENV["VITE_SUPABASE_URL"].presence
    key = ENV["SUPABASE_ANON_KEY"].presence || ENV["VITE_SUPABASE_ANON_KEY"].presence
    raise Unavailable, "Supabase URL and publishable key are required" unless url && key
    uri = URI("#{url.delete_suffix("/")}/auth/v1/user")
    unless uri.is_a?(URI::HTTPS) || (Rails.env.development? && %w[localhost 127.0.0.1].include?(uri.host))
      raise Unavailable, "Supabase must use HTTPS"
    end
    request = Net::HTTP::Get.new(uri)
    request["apikey"] = key
    request["Authorization"] = "Bearer #{token}"
    response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https",
      open_timeout: 5, read_timeout: 5) { |http| http.request(request) }

    raise Unavailable, "Cannot verify your account right now" if response.code.to_i >= 500 || response.code.to_i == 429
    raise Unauthorized, "Invalid or expired token" unless response.is_a?(Net::HTTPSuccess)
    ApiInput.uuid(JSON.parse(response.body).fetch("id"), "user id")
  rescue ApiInput::Invalid, KeyError, JSON::ParserError
    raise Unauthorized, "Invalid account"
  rescue Timeout::Error, SocketError, SystemCallError, IOError, OpenSSL::SSL::SSLError, URI::InvalidURIError
    raise Unavailable, "Cannot verify your account right now"
  end
end
