class AdoptProdpetTables < ActiveRecord::Migration[8.1]
  def up
    # Match the existing FastAPI schema and leave existing data/hypertables intact.
    timestamp = connection.adapter_name == "PostgreSQL" ? :timestamptz : :datetime
    unless table_exists?(:sessions)
      create_table :sessions, id: :string, limit: 36 do |t|
        t.string :user_id, limit: 36, null: false, index: true
        t.text :task, null: false
        t.column :date, timestamp, null: false
        t.integer :seconds, :duration, null: false
        t.string :mode, limit: 16, null: false
        t.integer :base, :bonus, :total, null: false
        t.column :created_at, timestamp, null: false
      end
    end

    unless table_exists?(:activity_events)
      create_table :activity_events, id: false do |t|
        t.column :time, timestamp, null: false
        t.string :session_id, :user_id, limit: 36, null: false
        t.string :event_type, limit: 32, null: false
        t.integer :focus_seconds, :points, null: false
        t.index [:time, :session_id], unique: true
        t.index :user_id
      end
    end

    unless table_exists?(:presence_events)
      create_table :presence_events, id: false do |t|
        t.column :time, timestamp, null: false
        t.string :id, :user_id, limit: 36, null: false
        t.string :session_id, limit: 36
        t.boolean :present, null: false
        t.string :source, limit: 16, null: false
        t.index [:time, :id], unique: true
        t.index :user_id
      end
    end

    create_table :penalty_receipts, id: false do |t|
      t.string :user_id, :event_id, limit: 36, null: false
      t.column :time, timestamp, null: false
      t.string :reason, null: false
      t.integer :points, null: false
      t.text :tip, null: false, default: ""
      t.float :confidence, null: false, default: 1
      t.string :session_id, limit: 36
      t.index [:user_id, :event_id], unique: true
    end
  end

  def down
    # This migration may have adopted existing production tables.
    raise ActiveRecord::IrreversibleMigration, "Restore a database backup to undo adoption"
  end
end
