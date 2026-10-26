class PresenceController < ApplicationController
  before_action :authorize_owner!, only: :quality

  def create
    session_id = ApiInput.uuid(params[:session_id], "session_id") if params[:session_id]
    present = params.fetch(:present, true)
    source = params.fetch(:source, "timer")
    raise ApiInput::Invalid, "present must be a boolean" unless [true, false].include?(present)
    raise ApiInput::Invalid, "source must be timer or vision" unless %w[timer vision].include?(source)

    event_id = SecureRandom.uuid
    time = Time.current
    PresenceEvent.create!(id: [time, event_id], user_id: @current_user_id,
      session_id: session_id, present: present, source: source)
    render json: { id: event_id, time: time, user_id: @current_user_id,
      session_id: session_id, present: present, source: source }, status: :created
  end

  def quality
    session_id = ApiInput.uuid(params[:session_id], "session_id") if params[:session_id]
    ticks = PresenceEvent.where(user_id: @current_user_id)
    ticks = ticks.where(session_id: session_id) if session_id
    total = ticks.count
    present = ticks.where(present: true).count
    percent = 0.0
    percent = (100.0 * present / total).round(1) if total.positive?
    render json: { user_id: @current_user_id, session_id: session_id,
      present_ticks: present, total_ticks: total, at_desk_percent: percent }
  end
end
