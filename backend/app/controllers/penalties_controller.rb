class PenaltiesController < ApplicationController
  POINTS = {
    "phone" => -50, "posture" => -25, "distracted" => -40,
    "tired" => -15, "stressed" => -20, "long_session" => -30
  }.freeze

  def create
    event_id = ApiInput.uuid(params[:id], "id")
    reason = params[:reason]
    raise ApiInput::Invalid, "unknown penalty reason" unless POINTS.key?(reason)
    tip = ApiInput.text(params.fetch(:tip, ""), "tip", maximum: 240)
    confidence = params.fetch(:confidence, 1)
    unless confidence.is_a?(Numeric) && confidence.between?(0, 1)
      raise ApiInput::Invalid, "confidence must be between 0 and 1"
    end
    session_id = ApiInput.uuid(params[:session_id], "session_id") if params[:session_id]
    key = { user_id: @current_user_id, event_id: event_id }
    existing = PenaltyReceipt.find_by(key)
    return render_receipt(existing) if existing

    # Preserve retries of penalties written before the Rails migration.
    legacy = ActivityEvent.penalties.find_by(user_id: @current_user_id, session_id: event_id)
    time = Time.current
    points = POINTS.fetch(reason)
    if legacy
      time, points = legacy.time, legacy.points
      reason = legacy.event_type.split(":", 2).last
    end

    receipt = nil
    PenaltyReceipt.transaction do
      receipt = PenaltyReceipt.create!(**key, time: time, reason: reason, points: points,
        tip: tip, confidence: confidence, session_id: session_id)
      unless legacy
        ActivityEvent.create!(time: time, session_id: event_id, user_id: @current_user_id,
          event_type: "habit_penalty:#{reason}", focus_seconds: 0, points: points)
      end
    end
    status = :created
    status = :ok if legacy
    render_receipt(receipt, status: status)
  rescue ActiveRecord::RecordNotUnique
    receipt = PenaltyReceipt.find_by(key)
    raise unless receipt
    render_receipt(receipt)
  end

  private

  def render_receipt(receipt, status: :ok)
    render json: {
      id: receipt.event_id, user_id: receipt.user_id, reason: receipt.reason,
      points: receipt.points, tip: receipt.tip, time: receipt.time
    }, status: status
  end
end
