require_relative "boot"
require "rails"
require "active_record/railtie"
require "action_controller/railtie"
require "rails/test_unit/railtie"
Bundler.require(*Rails.groups)

module ProdPet
  class Application < Rails::Application
    config.load_defaults 8.1
    config.api_only = true
    config.time_zone = "UTC"
    config.active_record.default_timezone = :utc
    config.filter_parameters += [:authorization, :token, :password, :apikey]
    config.action_controller.wrap_parameters_by_default = false
  end
end
