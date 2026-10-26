ENV["BUNDLE_GEMFILE"] ||= File.expand_path("../Gemfile", __dir__)
require "bundler/setup"
require "dotenv"
# Test runs must never read developer/cloud database credentials.
unless ENV["RAILS_ENV"] == "test"
  Dotenv.load(File.expand_path("../../.env", __dir__), File.expand_path("../.env", __dir__))
end
ENV.delete("DATABASE_URL") if ENV["DATABASE_URL"].to_s.empty?
