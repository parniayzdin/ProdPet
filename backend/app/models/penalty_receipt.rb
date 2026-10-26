# A normal table enforces retry uniqueness independently of Timescale's time key.
class PenaltyReceipt < ApplicationRecord
  self.primary_key = [:user_id, :event_id]
end
