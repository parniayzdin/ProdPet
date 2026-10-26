class StatsController < ApplicationController
  before_action :authorize_owner!

  def show
    render json: UserStatistics.new(@current_user_id).as_json
  end
end
