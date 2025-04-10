# == Schema Information
#
# Table name: nodes
#
#  node_id      :bigint           not null, primary key
#  latitude     :integer          not null
#  longitude    :integer          not null
#  changeset_id :bigint           not null
#  visible      :boolean          not null
#  timestamp    :datetime         not null
#  tile         :bigint           not null
#  version      :bigint           not null, primary key
#  redaction_id :integer
#
# Indexes
#
#  nodes_changeset_id_idx  (changeset_id)
#  nodes_tile_idx          (tile)
#  nodes_timestamp_idx     (timestamp)
#
# Foreign Keys
#
#  nodes_changeset_id_fkey  (changeset_id => changesets.id)
#  nodes_redaction_id_fkey  (redaction_id => redactions.id)
#

class OldNode < ApplicationRecord
  include GeoRecord

  self.table_name = "nodes"

  # NOTE: this needs to be included after the table name changes, or
  # the queries generated by Redactable will use the wrong table name.
  include Redactable

  validates :changeset, :associated => true
  validates :latitude, :presence => true,
                       :numericality => { :only_integer => true }
  validates :longitude, :presence => true,
                        :numericality => { :only_integer => true }
  validates :timestamp, :presence => true
  validates :visible, :inclusion => [true, false]

  validate :validate_position

  belongs_to :changeset
  belongs_to :redaction, :optional => true
  belongs_to :current_node, :class_name => "Node", :foreign_key => "node_id", :inverse_of => :old_nodes

  has_many :old_tags, :class_name => "OldNodeTag", :foreign_key => [:node_id, :version], :inverse_of => :old_node

  def validate_position
    errors.add(:base, "Node is not in the world") unless in_world?
  end

  def self.from_node(node)
    old_node = OldNode.new
    old_node.latitude = node.latitude
    old_node.longitude = node.longitude
    old_node.visible = node.visible
    old_node.tags = node.tags
    old_node.timestamp = node.timestamp
    old_node.changeset_id = node.changeset_id
    old_node.node_id = node.id
    old_node.version = node.version
    old_node
  end

  def save_with_dependencies!
    save!

    tags.each do |k, v|
      tag = OldNodeTag.new
      tag.k = k
      tag.v = v
      tag.node_id = node_id
      tag.version = version
      tag.save!
    end
  end

  def tags
    @tags ||= old_tags.to_h { |t| [t.k, t.v] }
  end

  attr_writer :tags

  # Pretend we're not in any ways
  def ways
    []
  end

  # Pretend we're not in any relations
  def containing_relation_members
    []
  end

  # check whether this element is the latest version - that is,
  # has the same version as its "current" counterpart.
  def latest_version?
    current_node.version == version
  end
end
