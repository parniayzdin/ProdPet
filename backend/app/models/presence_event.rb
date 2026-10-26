class PresenceEvent < ApplicationRecord
  self.primary_key = [:time, :id]
end
